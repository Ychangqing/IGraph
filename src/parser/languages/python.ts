/**
 * parser/languages/python.ts — Python 语言适配器
 *
 * 处理 .py / .pyi。Python 无 export 关键字，故约定：
 * - 模块顶层的 def / class / 顶层赋值变量视为「导出」符号（is_exported）；
 *   下划线开头（_foo）视为内部符号。
 * - 若模块存在 __all__ 列表，则以其为准判定导出（其余顶层符号降级为内部）。
 *
 * 提取风格与 ast-utils（TS/JS）保持一致：1-based 行号、endPosition 定 end_line、
 * 顶层符号名 → node、深度遍历收集 calls/refs。Python 缩进敏感，函数/类体的
 * end_line 一律取 AST node 的 endPosition，不做括号匹配。
 */
import type { SyntaxNode, Tree } from "tree-sitter";
import type { LanguageAdapter } from "./registry.js";
import type { GrammarId } from "../tree-sitter.js";
import type {
  CallExpression,
  ExportedSymbol,
  ImportStatement,
  InternalSymbol,
  NodeKind,
  Reference,
} from "../../types/index.js";

/** 1-based 起始行 */
function startLine(node: SyntaxNode): number {
  return node.startPosition.row + 1;
}
/** 1-based 结束行（缩进敏感，取 AST endPosition） */
function endLine(node: SyntaxNode): number {
  return node.endPosition.row + 1;
}

/** 下划线开头视为内部（私有）符号 */
function isPrivateName(name: string): boolean {
  return name.startsWith("_");
}

/** 顶层定义节点：直接子节点，或被 decorated_definition 包裹的 def/class */
interface Definition {
  /** 实际的 function_definition / class_definition 节点 */
  def: SyntaxNode;
  /** 取源码/行号的外层节点（有装饰器时为 decorated_definition，否则同 def） */
  wrapper: SyntaxNode;
}

/** 从顶层语句中还原出定义节点（穿透 decorated_definition） */
function definitionOf(stmt: SyntaxNode): Definition | undefined {
  if (stmt.type === "function_definition" || stmt.type === "class_definition") {
    return { def: stmt, wrapper: stmt };
  }
  if (stmt.type === "decorated_definition") {
    const def = stmt.namedChildren.find(
      (c) => c.type === "function_definition" || c.type === "class_definition",
    );
    if (def) return { def, wrapper: stmt };
  }
  return undefined;
}

/** function_definition名：参数列表 + 返回类型注解 */
function functionSignature(def: SyntaxNode): string {
  const params = def.childForFieldName("parameters");
  const paramsText = params ? params.text : "()";
  const ret = def.childForFieldName("return_type");
  const retText = ret ? ` -> ${ret.text}` : "";
  return `${paramsText}${retText}`.replace(/\s+/g, " ").trim();
}

/** 从 class_definition 的 superclasses(argument_list) 提取第一个基类名与其余基类名 */
function extractBases(classDef: SyntaxNode): {
  extendsName?: string;
  implementsNames?: string[];
} {
  const args = classDef.childForFieldName("superclasses");
  if (!args) return {};
  const names: string[] = [];
  for (const c of args.namedChildren) {
    // 基类可能是 identifier 或 attribute（module.Base），取其文本
    if (c.type === "identifier" || c.type === "attribute") names.push(c.text);
  }
  if (names.length === 0) return {};
  const result: { extendsName?: string; implementsNames?: string[] } = {
    extendsName: names[0],
  };
  if (names.length > 1) result.implementsNames = names.slice(1);
  return result;
}

/** 通用符号形状（导出与非导出共用） */
interface RawSymbol {
  name: string;
  kind: NodeKind;
  signature: string;
  startLine: number;
  endLine: number;
  sourceCode: string;
  extendsName?: string;
  implementsNames?: string[];
}

/** 从一个定义节点提取符号（def→function、class→class） */
function symbolFromDefinition(d: Definition): RawSymbol | undefined {
  const nameNode = d.def.childForFieldName("name");
  if (!nameNode) return undefined;
  const name = nameNode.text;
  if (d.def.type === "function_definition") {
    return {
      name,
      kind: "function",
      signature: functionSignature(d.def),
      startLine: startLine(d.wrapper),
      endLine: endLine(d.wrapper),
      sourceCode: d.wrapper.text,
    };
  }
  // class_definition
  return {
    name,
    kind: "class",
    signature: `class ${name}`,
    startLine: startLine(d.wrapper),
    endLine: endLine(d.wrapper),
    sourceCode: d.wrapper.text,
    ...extractBases(d.def),
  };
}

/** 从顶层赋值语句提取变量符号（可能一次赋多个：a = b = 1 或 a, b = ...） */
function symbolsFromAssignment(stmt: SyntaxNode): RawSymbol[] {
  // expression_statement > assignment，assignment 的 left 字段为标识符或模式
  const assign = stmt.namedChildren.find((c) => c.type === "assignment");
  if (!assign) return [];
  const left = assign.childForFieldName("left");
  if (!left) return [];
  const out: RawSymbol[] = [];
  const pushIdent = (id: SyntaxNode): void => {
    out.push({
      name: id.text,
      kind: "variable",
      signature: `${id.text} = ...`,
      startLine: startLine(stmt),
      endLine: endLine(stmt),
      sourceCode: stmt.text,
    });
  };
  if (left.type === "identifier") {
    pushIdent(left);
  } else if (left.type === "pattern_list" || left.type === "tuple_pattern") {
    for (const c of left.namedChildren) {
      if (c.type === "identifier") pushIdent(c);
    }
  }
  return out;
}

/** 解析 __all__ = [...] 中的字符串名单；不存在返回 undefined */
function parseDunderAll(root: SyntaxNode): Set<string> | undefined {
  for (const stmt of root.namedChildren) {
    if (stmt.type !== "expression_statement") continue;
    const assign = stmt.namedChildren.find((c) => c.type === "assignment");
    if (!assign) continue;
    const left = assign.childForFieldName("left");
    if (!left || left.type !== "identifier" || left.text !== "__all__") continue;
    const right = assign.childForFieldName("right");
    if (!right) continue;
    const names = new Set<string>();
    for (const s of right.descendantsOfType("string")) {
      // string_content 子节点即去引号后的内容
      const content = s.descendantsOfType("string_content")[0];
      names.add(content ? content.text : s.text.replace(/^['"]|['"]$/g, ""));
    }
    return names;
  }
  return undefined;
}

/** 收集所有顶层定义与赋值产出的原始符号 */
function collectTopLevelSymbols(root: SyntaxNode): RawSymbol[] {
  const out: RawSymbol[] = [];
  for (const stmt of root.namedChildren) {
    const def = definitionOf(stmt);
    if (def) {
      const sym = symbolFromDefinition(def);
      if (sym) out.push(sym);
      continue;
    }
    if (stmt.type === "expression_statement") {
      out.push(...symbolsFromAssignment(stmt));
    }
  }
  return out;
}

/** 判定某符号是否导出：有 __all__ 以其为准，否则「非下划线开头」即导出 */
function isExportedName(name: string, dunderAll: Set<string> | undefined): boolean {
  if (dunderAll) return dunderAll.has(name);
  return !isPrivateName(name);
}

/** Pass 1：提取导出符号 */
export function extractExports(root: SyntaxNode): ExportedSymbol[] {
  const dunderAll = parseDunderAll(root);
  const out: ExportedSymbol[] = [];
  for (const sym of collectTopLevelSymbols(root)) {
    if (!isExportedName(sym.name, dunderAll)) continue;
    out.push({ ...sym, isDefault: false });
  }
  return out;
}

/** Pass 2：提取内部（非导出）顶层符号 */
export function extractInternalSymbols(root: SyntaxNode): InternalSymbol[] {
  const dunderAll = parseDunderAll(root);
  const out: InternalSymbol[] = [];
  for (const sym of collectTopLevelSymbols(root)) {
    if (isExportedName(sym.name, dunderAll)) continue;
    out.push(sym);
  }
  return out;
}

/** dotted_name → 文本（如 pkg.sub.mod） */
function dottedNameText(node: SyntaxNode): string {
  return node.text;
}

/** Pass 3：解析 import / from-import（含相对导入） */
export function extractImports(root: SyntaxNode): ImportStatement[] {
  const out: ImportStatement[] = [];
  for (const stmt of root.namedChildren) {
    const line = startLine(stmt);

    // ── import x  /  import x as y  /  import a.b, c ──
    if (stmt.type === "import_statement") {
      for (const child of stmt.namedChildren) {
        if (child.type === "dotted_name") {
          const spec = dottedNameText(child);
          const local = child.namedChildren[child.namedChildren.length - 1]?.text ?? spec;
          out.push({
            moduleSpecifier: spec,
            kind: "namespace",
            bindings: [{ imported: "*", local }],
            line,
          });
        } else if (child.type === "aliased_import") {
          const nameNode = child.childForFieldName("name");
          const aliasNode = child.childForFieldName("alias");
          const spec = nameNode ? dottedNameText(nameNode) : child.text;
          const local = aliasNode ? aliasNode.text : spec;
          out.push({
            moduleSpecifier: spec,
            kind: "namespace",
            bindings: [{ imported: "*", local }],
            line,
          });
        }
      }
      continue;
    }

    // ── from m import a, b  /  from . import x  /  from .mod import y ──
    if (stmt.type === "import_from_statement") {
      const moduleNode = stmt.childForFieldName("module_name");
      // 相对导入前缀（. / ..），用于拼出以 '.' 开头的说明符
      const relative = stmt.namedChildren.find((c) => c.type === "relative_import");
      let spec = "";
      if (relative) {
        // relative_import: import_prefix(.) [dotted_name]
        const prefix = relative.namedChildren.find((c) => c.type === "import_prefix");
        const dotted = relative.namedChildren.find((c) => c.type === "dotted_name");
        spec = `${prefix ? prefix.text : "."}${dotted ? dotted.text : ""}`;
      } else if (moduleNode) {
        spec = dottedNameText(moduleNode);
      } else {
        // 兜底：首个 dotted_name 作为模块
        const first = stmt.namedChildren.find((c) => c.type === "dotted_name");
        spec = first ? dottedNameText(first) : "";
      }
      if (!spec) continue;

      // from ... import *  （wildcard_import）
      const wildcard = stmt.namedChildren.find((c) => c.type === "wildcard_import");
      if (wildcard) {
        out.push({
          moduleSpecifier: spec,
          kind: "namespace",
          bindings: [{ imported: "*", local: "*" }],
          line,
        });
        continue;
      }

      // 被导入的名字：module 之后的 dotted_name / aliased_import
      const bindings: Array<{ imported: string; local: string }> = [];
      // 跳过作为模块的那个 dotted_name（相对导入时模块在 relative_import 内，不占顶层）
      const moduleDotted = relative ? undefined : moduleNode ?? stmt.namedChildren.find((c) => c.type === "dotted_name");
      for (const child of stmt.namedChildren) {
        if (child === moduleDotted || child.type === "relative_import") continue;
        if (child.type === "dotted_name") {
          const imported = child.namedChildren[child.namedChildren.length - 1]?.text ??child.text;
          bindings.push({ imported, local: imported });
        } else if (child.type === "aliased_import") {
          const nameNode = child.childForFieldName("name");
          const aliasNode = child.childForFieldName("alias");
          const imported = nameNode
            ? (nameNode.namedChildren[nameNode.namedChildren.length - 1]?.text ?? nameNode.text)
            : child.text;
          bindings.push({ imported, local: aliasNode ? aliasNode.text : imported });
        }
      }
      if (bindings.length > 0) {
        out.push({ moduleSpecifier: spec, kind: "named", bindings, line });
      }
    }
  }
  return out;
}

/** 深度遍历所有后代节点 */
function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}

/**
 * 找到某节点所属的顶层符号名（caller / enclosing）。
 * 向上回溯到 module 的直接子节点，穿透 decorated_definition，取其 name。
 */
function enclosingSymbolName(node: SyntaxNode): string | undefined {
  let cur: SyntaxNode | null = node;
  while (cur && cur.parent && cur.parent.type !== "module") {
    cur = cur.parent;
  }
  if (!cur) return undefined;
  let decl = cur;
  if (decl.type === "decorated_definition") {
    const inner = decl.namedChildren.find(
      (c) => c.type === "function_definition" || c.type === "class_definition",
    );
    if (inner) decl = inner;
  }
  const nameNode = decl.childForFieldName("name");
  if (nameNode) return nameNode.text;
  if (decl.type === "expression_statement") {
    const assign = decl.namedChildren.find((c) => c.type === "assignment");
    const left = assign?.childForFieldName("left");
    if (left && left.type === "identifier") return left.text;
  }
  return undefined;
}

/** Pass 4：提取函数调用（call 节点） */
export function extractCalls(root: SyntaxNode): CallExpression[] {
  const out: CallExpression[] = [];
  walk(root, (n) => {
    if (n.type !== "call") return;
    const fn = n.childForFieldName("function");
    if (!fn) return;
    let calleeName: string | undefined;
    if (fn.type === "identifier") {
      calleeName = fn.text;
    } else if (fn.type === "attribute") {
      // a.b() → 取属性名 b（attribute 的 attribute 字段）
      const attr = fn.childForFieldName("attribute");
      if (attr) calleeName = attr.text;
    }
    if (!calleeName) return;
    const enclosing = enclosingSymbolName(n);
    out.push(
      enclosing === undefined
        ? { calleeName, line: startLine(n) }
        : { calleeName, line: startLine(n), enclosingSymbol: enclosing },
    );
  });
  return out;
}

/**
 * Pass 5：提取非调用引用。
 * Python 无 JSX，非调用引用来自：
 * - 类型注解（type 节点内的 identifier）
 * - 类继承基类（class 的 superclasses 内 identifier）
 * - 装饰器引用（decorator 内的 identifier）
 * 统一记为 refKind='type'（现有模型仅 'type' | 'jsx'）。
 */
export function extractRefs(root: SyntaxNode): Reference[] {
  const out: Reference[] = [];
  const push = (name: string, node: SyntaxNode): void => {
    const enclosing = enclosingSymbolName(node);
    out.push(
      enclosing === undefined
        ? { name, line: startLine(node), refKind: "type" }
        : { name, line: startLine(node), enclosingSymbol: enclosing, refKind: "type" },
    );
  };
  walk(root, (n) => {
    // 类型注解：type 节点（typed_parameter 的注解、return_type、变量注解）
    if (n.type === "type") {
      for (const id of n.descendantsOfType("identifier")) push(id.text, id);
      return;
    }
    // 类继承基类
    if (n.type === "class_definition") {
      const args = n.childForFieldName("superclasses");
      if (args) {
        for (const c of args.namedChildren) {
          if (c.type === "identifier") push(c.text, c);
        }
      }
      return;
    }
    // 装饰器引用：@decorator / @mod.decorator
    if (n.type === "decorator") {
      const id = n.namedChildren.find(
        (c) => c.type === "identifier" || c.type === "attribute" || c.type === "call",
      );
      if (id) {
        // 装饰器可能是 call（@deco(arg)）——取其 function 名；否则取标识符
        let name: string | undefined;
        if (id.type === "call") {
          const fn = id.childForFieldName("function");
          name = fn?.type === "identifier" ? fn.text : undefined;
        } else if (id.type === "identifier") {
          name = id.text;
        }
        if (name) push(name, n);
      }
    }
  });
  return out;
}

export const pythonAdapter: LanguageAdapter = {
  id: "python",
  extensions: [".py", ".pyi"],
  grammarFor(_filePath: string): GrammarId {
    return "python";
  },
  extractExports: (tree: Tree) => extractExports(tree.rootNode),
  extractInternalSymbols: (tree: Tree) => extractInternalSymbols(tree.rootNode),
  extractImports: (tree: Tree) => extractImports(tree.rootNode),
  extractCalls: (tree: Tree) => extractCalls(tree.rootNode),
  extractRefs: (tree: Tree) => extractRefs(tree.rootNode),
};