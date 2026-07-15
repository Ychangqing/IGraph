/**
 * parser/index.ts — 5-Pass 解析流水线整合
 *
 * 职责：扫描文件 → 逐文件解析（Pass1/2 建节点，Pass3 建 imports/extends/implements 边）
 * → 全局 Pass4（calls）/Pass5（refs）建边。产出内存 ParseResult。
 *
 * 边的 source/target 使用临时标识 `${filePath}#${name}`（见 types 注释），M2 落库后替换。
 * 文件级来源用「文件入口」节点标识 `${filePath}#*`（kind=module），代表文件本身，
 * 使 imports 边及顶层 calls/refs 边的 source 可映射到真实 node id。
 *
 * Pass4 调用匹配优先级：同文件 > import 绑定 > 同目录 > 全局同名（weak）。
 */
import { scanFiles } from "./file-scanner.js";
import { parse } from "./tree-sitter.js";
import {
  getAdapterForFile,
  registerAdapter,
  clearRegistry,
} from "./languages/registry.js";
import { typescriptAdapter } from "./languages/typescript.js";
import { javascriptAdapter } from "./languages/javascript.js";
import { pythonAdapter } from "./languages/python.js";
import { javaAdapter } from "./languages/java.js";
import { goAdapter } from "./languages/go.js";
import type {
  CallExpression,
  CodeEdge,
  CodeNode,
  ImportStatement,
  ParseResult,
  Reference,
  ScannedFile,
} from "../types/index.js";

/** 确保内置适配器已注册（幂等） */
export function registerBuiltinAdapters(): void {
  clearRegistry();
  registerAdapter(typescriptAdapter);
  registerAdapter(javascriptAdapter);
  registerAdapter(pythonAdapter);
  registerAdapter(javaAdapter);
  registerAdapter(goAdapter);
}

/** 构造临时节点标识 */
function nodeId(filePath: string, name: string): string {
  return `${filePath}#${name}`;
}

/**
 * 构造「文件入口」节点标识：`${filePath}#*`。
 * 该节点代表文件本身（kind=module），作为 imports 边以及顶层
 * calls/refs 边的 source，使这些原本无法映射到具体符号的边可正常落库。
 */
function fileNodeId(filePath: string): string {
  return `${filePath}#*`;
}

/** 目录部分（posix） */
function dirOf(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i < 0 ? "" : filePath.slice(0, i);
}

/** posix 路径规整：处理 . 与 .. */
function normalizePosix(path: string): string {
  const parts = path.split("/");
  const stack: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") stack.pop();
      else stack.push("..");
    } else {
      stack.push(p);
    }
  }
  return stack.join("/");
}

/**
 * 将相对 import 说明符解析为仓库内候选文件路径集合（用于匹配已扫描文件）。
 * 非相对（裸模块，如 'react'）返回空集合。
 */
function resolveImportCandidates(fromFile: string, spec: string): string[] {
  if (!spec.startsWith(".")) return [];
  const exts = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
  const base = normalizePosix(`${dirOf(fromFile)}/${spec}`);
  const out: string[] = [];
  // 直接带扩展名
  out.push(base);
  // TS 项目里常写成 `./x.js` 但实际文件是 `./x.ts`：剥离 JS 扩展名后按 TS 扩展名再解析
  const jsExts = [".js", ".jsx", ".mjs", ".cjs"];
  const matchedJs = jsExts.find((e) => base.endsWith(e));
  const stem = matchedJs ? base.slice(0, -matchedJs.length) : base;
  // 补扩展名（对原 base 与剥离后的 stem 都尝试）
  for (const e of exts) out.push(`${base}${e}`);
  if (matchedJs) {
    for (const e of exts) out.push(`${stem}${e}`);
  }
  // index 文件
  for (const e of exts) out.push(`${stem}/index${e}`);
  return out;
}

interface FileParse {
  file: ScannedFile;
  /** 本文件所有节点名 → node id */
  localNames: Map<string, string>;
  imports: ImportStatement[];
  calls: CallExpression[];
  refs: Reference[];
}

/**
 * 解析给定仓库根目录，产出内存图谱。
 * @param root 仓库根绝对路径
 * @param include glob 包含
 * @param exclude glob 排除
 */
export async function parseRepository(options: {
  root: string;
  include: string[];
  exclude: string[];
  onlyPaths?: string[];
}): Promise<ParseResult> {
  registerBuiltinAdapters();
  const { root, include, exclude, onlyPaths } = options;
  const files = await scanFiles({
    root,
    include,
    exclude,
    onlyPaths: onlyPaths ? new Set(onlyPaths) : undefined,
  });

  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const edgeSeen = new Set<string>();

  /** 全局：符号名 → 所有拥有该名字的 node id 列表（用于 weak 兜底） */
  const globalNames = new Map<string, string[]>();
  /** 文件路径 → 该文件解析上下文 */
  const fileParses: FileParse[] = [];
  /** node id → CodeNode（快速查存在性） */
  const nodeById = new Map<string, CodeNode>();

  const addNode = (n: CodeNode): void => {
    if (nodeById.has(n.id)) return;
    nodes.push(n);
    nodeById.set(n.id, n);
    const arr = globalNames.get(n.name);
    if (arr) arr.push(n.id);
    else globalNames.set(n.name, [n.id]);
  };

  const addEdge = (e: CodeEdge): void => {
    const key = `${e.source}->${e.target}:${e.kind}`;
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);
    edges.push(e);
  };

  // ── 第一轮：Pass1/2 建节点，收集 imports ──
  for (const file of files) {
    const adapter = getAdapterForFile(file.absPath) ?? getAdapterForFile(file.filePath);
    if (!adapter) continue;
    const grammar = adapter.grammarFor(file.filePath);
    let tree;
    try {
      tree = parse(file.sourceCode, grammar);
    } catch {
      // tree-sitter 无法解析该文件（可能含不支持的编码或内容），跳过
      continue;
    }

    const localNames = new Map<string, string>();
    const exports = adapter.extractExports(tree, file.sourceCode);
    const internals = adapter.extractInternalSymbols(tree, file.sourceCode);

    // 文件入口节点（kind=module）：代表「文件本身」，id=`${filePath}#*`。
    // 作为 imports 边及顶层 calls/refs 边的 source。不加入 localNames，
    // 避免污染 Pass4/5 的同名符号匹配。
    addNode({
      name: file.filePath,
      kind: "module",
      signature: "",
      startLine: 1,
      endLine: 1,
      isExported: false,
      sourceCode: "",
      filePath: file.filePath,
      id: fileNodeId(file.filePath),
    });

    for (const s of exports) {
      const id = nodeId(file.filePath, s.name);
      addNode({
        name: s.name,
        kind: s.kind,
        signature: s.signature,
        startLine: s.startLine,
        endLine: s.endLine,
        isExported: true,
        sourceCode: s.sourceCode,
        filePath: file.filePath,
        id,
      });
      localNames.set(s.name, id);
      // extends / implements 边（目标暂用同名全局匹配，在第二轮解析）
      if (s.extendsName) {
        addEdge({ source: id, target: `?#${s.extendsName}`, kind: "extends", weak: true });
      }
      for (const impl of s.implementsNames ?? []) {
        addEdge({ source: id, target: `?#${impl}`, kind: "implements", weak: true });
      }
    }
    for (const s of internals) {
      const id = nodeId(file.filePath, s.name);
      addNode({
        name: s.name,
        kind: s.kind,
        signature: s.signature,
        startLine: s.startLine,
        endLine: s.endLine,
        isExported: false,
        sourceCode: s.sourceCode,
        filePath: file.filePath,
        id,
      });
      localNames.set(s.name, id);
    }

    const imports = adapter.extractImports(tree, file.sourceCode);
    const calls = adapter.extractCalls(tree, file.sourceCode);
    const refs = adapter.extractRefs(tree, file.sourceCode);
    fileParses.push({ file, localNames, imports, calls, refs });
  }

  // 便于按路径查已扫描文件
  const filePathSet = new Set(files.map((f) => f.filePath));
  // 预建 filePath → FileParse 索引，Pass3 查目标文件用 O(1) Map.get() 替代线性 find。
  const fileParseByPath = new Map<string, FileParse>();
  for (const fp of fileParses) fileParseByPath.set(fp.file.filePath, fp);
  const resolveImportedFile = (fromFile: string, spec: string): string | undefined => {
    for (const cand of resolveImportCandidates(fromFile, spec)) {
      if (filePathSet.has(cand)) return cand;
    }
    return undefined;
  };

  // ── extends / implements 边补目标：优先同名节点，唯一时指向具体 id ──
  const resolveByName = (name: string): string | undefined => {
    const ids = globalNames.get(name);
    if (ids && ids.length === 1) return ids[0];
    return undefined;
  };
  // 重写 heritage 占位边（?#Name）为真实目标
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!e) continue;
    if ((e.kind === "extends" || e.kind === "implements") && e.target.startsWith("?#")) {
      const name = e.target.slice(2);
      const target = resolveByName(name);
      if (target) {
        e.target = target;
        e.weak = false;
      }
    }
  }

  // ── 第二轮：Pass3 imports 边、Pass4 calls 边、Pass5 refs 边 ──
  for (const fp of fileParses) {
    const fromFile = fp.file.filePath;

    // 本文件 import 本地名 → 目标 node id（用于 Pass4/5 跨文件匹配）
    const importLocalToTarget = new Map<string, string>();

    // Pass3：imports 边（模块级：本文件任一节点 → 目标符号）
    for (const imp of fp.imports) {
      const targetFile = resolveImportedFile(fromFile, imp.moduleSpecifier);
      if (!targetFile) continue; // 裸模块/外部依赖，跳过
      const targetFp = fileParseByPath.get(targetFile);
      if (!targetFp) continue;
      for (const b of imp.bindings) {
        // named：按 imported 名找目标文件同名节点；default/namespace：取目标文件任意导出
        let targetId: string | undefined;
        if (imp.kind === "named") {
          targetId = targetFp.localNames.get(b.imported);
        } else {
          // default/namespace/require：优先目标文件与本地名同名，否则任一节点
          targetId =
            targetFp.localNames.get(b.local) ??
            targetFp.localNames.values().next().value;
        }
        if (!targetId) continue;
        importLocalToTarget.set(b.local, targetId);
        // imports 边：source 为文件入口节点（`${fromFile}#*`，kind=module），
        // target 为被导入的具体符号；两端均可映射到真实 node id。
        addEdge({ source: fileNodeId(fromFile), target: targetId, kind: "imports" });
      }
    }

    // Pass4：calls 边（优先级：同文件 > import > 同目录 > 全局 weak）
    const fromDir = dirOf(fromFile);
    for (const call of fp.calls) {
      const sourceId =
        call.enclosingSymbol && fp.localNames.has(call.enclosingSymbol)
          ? fp.localNames.get(call.enclosingSymbol)!
          : fileNodeId(fromFile);
      const target = matchTarget(call.calleeName, {
        localNames: fp.localNames,
        importLocalToTarget,
        fileParses,
        fromDir,
        globalNames,
      });
      if (!target) continue;
      addEdge({ source: sourceId, target: target.id, kind: "calls", weak: target.weak });
    }

    // Pass5：refs 边（类型引用 / JSX 组件）
    for (const ref of fp.refs) {
      const sourceId =
        ref.enclosingSymbol && fp.localNames.has(ref.enclosingSymbol)
          ? fp.localNames.get(ref.enclosingSymbol)!
          : fileNodeId(fromFile);
      const target = matchTarget(ref.name, {
        localNames: fp.localNames,
        importLocalToTarget,
        fileParses,
        fromDir,
        globalNames,
      });
      if (!target) continue;
      addEdge({ source: sourceId, target: target.id, kind: "refs", weak: target.weak });
    }
  }

  return { files, nodes, edges };
}

/** Pass4/5 目标匹配：按优先级返回 node id 与是否 weak */
function matchTarget(
  name: string,
  ctx: {
    localNames: Map<string, string>;
    importLocalToTarget: Map<string, string>;
    fileParses: FileParse[];
    fromDir: string;
    globalNames: Map<string, string[]>;
  },
): { id: string; weak: boolean } | undefined {
  // 1) 同文件
  const local = ctx.localNames.get(name);
  if (local) return { id: local, weak: false };
  // 2) import 绑定
  const imported = ctx.importLocalToTarget.get(name);
  if (imported) return { id: imported, weak: false };
  // 3) 同目录其他文件
  for (const fp of ctx.fileParses) {
    if (dirOf(fp.file.filePath) !== ctx.fromDir) continue;
    const id = fp.localNames.get(name);
    if (id) return { id, weak: false };
  }
  // 4) 全局同名（weak，唯一时才建，避免噪声）
  const ids = ctx.globalNames.get(name);
  if (ids && ids.length === 1 && ids[0]) return { id: ids[0], weak: true };
  return undefined;
}