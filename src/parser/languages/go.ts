/**
 * parser/languages/go.ts — Go 语言适配器
 *
 * 处理 .go。Go 的导出语义与 Java 的 `public` 修饰符、Python 的下划线约定都不同：
 * - 标识符**首字母大写**即为导出（exported，包外可见，is_exported=true）；
 * - 首字母小写为包内私有（unexported / package-private，is_exported=false）。
 * - 无首字母（如空名或以下划线/数字开头的非法名）一律按非导出处理。
 *
 * 提取风格与其它适配器保持一致：1-based 行号、endPosition 定 end_line。
 * 顶层符号：function_declaration / method_declaration（含 receiver）/
 * type_declaration（struct→class、interface→type、其它→type）/ const / var 声明。
 * 深度遍历收集 call_expression（calls）与 type_identifier（refs）。
 *
 * tree-sitter-go 关键节点：
 * - 顶层：function_declaration（name=identifier）/ method_declaration
 *   （receiver=首个 parameter_list，name=field_identifier）/
 *   type_declaration>type_spec（name=type_identifier，type=struct_type|interface_type|...）/
 *   const_declaration>const_spec / var_declaration>var_spec（name=identifier，可多个）/
 *   import_declaration>import_spec_list>import_spec（path=字符串，name=可选别名）
 * - 调用：call_expression（function 字段 = identifier | selector_expression）
 * - 类型引用：type_identifier
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
/** 1-based 结束行（取 AST endPosition） */
function endLine(node: SyntaxNode): number {
  return node.endPosition.row + 1;
}

/**
 * Go 导出判定：标识符首字母为大写 Unicode 字母即导出。
 * Go 规范用 unicode.IsUpper 判断；这里用 JS 大小写折叠近似（对 ASCII 与常见 Unicode 足够）。
 */
function isExportedName(name: string): boolean {
  if (name.length === 0) return false;
  const first = name[0]!;
  // 首字符须为字母且等于其大写形式且不等于其小写形式（排除数字/下划线/符号）
  return first !== first.toLowerCase() && first === first.toUpperCase();
}

/** 去掉字符串字面量两端引号（"..." 或 `...`） */
function unquote(text: string): string {
  if (text.length >= 2) {
    const q = text[0];
    if ((q === '"' || q === "`") && text[text.length - 1] === q) {
      return text.slice(1, -1);
    }
  }
  return text;
}

/** 通用符号形状（导出与非导出共用） */
interface RawSymbol {
  name: string;
  kind: NodeKind;
  signature: string;
  startLine: number;
  endLine: number;
  sourceCode: string;
  isExported: boolean;
}

/** 函数/方法签名：形参列表 + 返回类型（压缩空白） */
function funcSignature(decl: SyntaxNode): string {
  // function_declaration/method_declaration 的入参用 childForFieldName("parameters")
  const params = decl.childForFieldName("parameters");
  const paramsText = params ? params.text : "()";
  const ret = decl.childForFieldName("result");
  const retText = ret ? ` ${ret.text}` : "";
  return `${paramsText}${retText}`.replace(/\s+/g, " ").trim();
}

/** type_spec 的 kind 映射：struct → class；interface / 其它 → type */
function typeSpecKind(typeSpec: SyntaxNode): NodeKind {
  const typeNode = typeSpec.childForFieldName("type");
  if (typeNode && typeNode.type === "struct_type") return "class";
  return "type";
}

/** 收集 function_declaration 符号 */
function collectFunction(decl: SyntaxNode): RawSymbol | undefined {
  const nameNode = decl.childForFieldName("name");
  if (!nameNode) return undefined;
  const name = nameNode.text;
  return {
    name,
    kind: "function",
    signature: `func ${name}${funcSignature(decl)}`,
    startLine: startLine(decl),
    endLine: endLine(decl),
    sourceCode: decl.text,
    isExported: isExportedName(name),
  };
}

/** 收集 method_declaration 符号（含 receiver） */
function collectMethod(decl: SyntaxNode): RawSymbol | undefined {
  const nameNode = decl.childForFieldName("name");
  if (!nameNode) return undefined;
  const name = nameNode.text;
  // receiver：method_declaration 的 childForFieldName("receiver")
  const receiver = decl.childForFieldName("receiver");
  const recvText = receiver ? `${receiver.text} ` : "";
  return {
    name,
    kind: "method",
    signature: `func ${recvText}${name}${funcSignature(decl)}`.replace(/\s+/g, " ").trim(),
    startLine: startLine(decl),
    endLine: endLine(decl),
    sourceCode: decl.text,
    isExported: isExportedName(name),
  };
}

/** 收集 type_declaration 内的 type_spec（可能多个：type ( A struct{}; b int )） */
function collectTypeSpecs(decl: SyntaxNode): RawSymbol[] {
  const out: RawSymbol[] = [];
  for (const spec of decl.namedChildren) {
    if (spec.type !== "type_spec" && spec.type !== "type_alias") continue;
    const nameNode = spec.childForFieldName("name");
    if (!nameNode) continue;
    const name = nameNode.text;
    const kind = typeSpecKind(spec);
    const keyword = kind === "class" ? "struct" : "type";
    out.push({
      name,
      kind,
      signature: `${keyword} ${name}`,
      startLine: startLine(spec),
      endLine: endLine(spec),
      sourceCode: spec.text,
      isExported: isExportedName(name),
    });
  }
  return out;
}

/** 收集 const_declaration / var_declaration 内的名字（每个 spec 可声明多个 name） */
function collectValueDecls(decl: SyntaxNode, specType: "const_spec" | "var_spec"): RawSymbol[] {
  const out: RawSymbol[] = [];
  for (const spec of decl.namedChildren) {
    if (spec.type !== specType) continue;
    // name 字段可能有多个（a, b = 1, 2）：遍历 named children 取 identifier
    for (const child of spec.namedChildren) {
      if (child.type !== "identifier") continue;
      const name = child.text;
      out.push({
        name,
        // NodeKind 无 constant，const/var 统一记为 variable
        kind: "variable",
        signature: spec.text.replace(/\s+/g, " ").trim(),
        startLine: startLine(spec),
        endLine: endLine(spec),
        sourceCode: spec.text,
        isExported: isExportedName(name),
      });
    }
  }
  return out;
}

/** 收集所有顶层符号 */
function collectSymbols(root: SyntaxNode): RawSymbol[] {
  const out: RawSymbol[] = [];
  for (const stmt of root.namedChildren) {
    switch (stmt.type) {
      case "function_declaration": {
        const s = collectFunction(stmt);
        if (s) out.push(s);
        break;
      }
      case "method_declaration": {
        const s = collectMethod(stmt);
        if (s) out.push(s);
        break;
      }
      case "type_declaration":
        out.push(...collectTypeSpecs(stmt));
        break;
      case "const_declaration":
        out.push(...collectValueDecls(stmt, "const_spec"));
        break;
      case "var_declaration":
        out.push(...collectValueDecls(stmt, "var_spec"));
        break;
      default:
        break;
    }
  }
  return out;
}

/** Pass 1：提取导出符号（首字母大写） */
export function extractExports(root: SyntaxNode): ExportedSymbol[] {
  const out: ExportedSymbol[] = [];
  for (const sym of collectSymbols(root)) {
    if (!sym.isExported) continue;
    const { isExported: _drop, ...rest } = sym;
    out.push({ ...rest, isDefault: false });
  }
  return out;
}

/** Pass 2：提取内部（首字母小写）符号 */
export function extractInternalSymbols(root: SyntaxNode): InternalSymbol[] {
  const out: InternalSymbol[] = [];
  for (const sym of collectSymbols(root)) {
    if (sym.isExported) continue;
    const { isExported: _drop, ...rest } = sym;
    out.push(rest);
  }
  return out;
}

/** Pass 3：解析 import 声明（单行 import 与括号分组 import 均落到 import_spec） */
export function extractImports(root: SyntaxNode): ImportStatement[] {
  const out: ImportStatement[] = [];
  for (const stmt of root.namedChildren) {
    if (stmt.type !== "import_declaration") continue;
    for (const spec of stmt.descendantsOfType("import_spec")) {
      const pathNode = spec.childForFieldName("path");
      if (!pathNode) continue;
      const moduleSpecifier = unquote(pathNode.text);
      const line = startLine(spec);
      const aliasNode = spec.childForFieldName("name");
      if (aliasNode) {
        const alias = aliasNode.text;
        // 点导入 `. "pkg"` 与空白导入 `_ "pkg"` 也归入 named/namespace
        if (alias === "." || alias === "_") {
          out.push({
            moduleSpecifier,
            kind: "namespace",
            bindings: [{ imported: "*", local: alias }],
            line,
          });
        } else {
          out.push({
            moduleSpecifier,
            kind: "named",
            bindings: [{ imported: alias, local: alias }],
            line,
          });
        }
        continue;
      }
      // 无别名：本地名取导入路径最末段（math/rand → rand）
      const local = moduleSpecifier.slice(moduleSpecifier.lastIndexOf("/") + 1);
      out.push({
        moduleSpecifier,
        kind: "named",
        bindings: [{ imported: local, local }],
        line,
      });
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
 * 找到某节点所属的最近函数/方法/类型符号名（caller / enclosing）。
 * 向上回溯，优先取 function/method 名，其次取 type_spec 名。
 */
function enclosingSymbolName(node: SyntaxNode): string | undefined {
  let cur: SyntaxNode | null = node.parent;
  while (cur) {
    if (cur.type === "function_declaration" || cur.type === "method_declaration") {
      const n = cur.childForFieldName("name");
      if (n) return n.text;
    }
    if (cur.type === "type_spec") {
      const n = cur.childForFieldName("name");
      if (n) return n.text;
    }
    cur = cur.parent;
  }
  return undefined;
}

/**
 * 从 call_expression 的 function 字段取被调名。
 * - identifier：直接调用（helper() → helper）
 * - selector_expression：包/接收者调用（fmt.Println / p.Move → 取末段 field 名）
 */
function calleeNameOf(call: SyntaxNode): string | undefined {
  const fn = call.childForFieldName("function");
  if (!fn) return undefined;
  if (fn.type === "identifier") return fn.text;
  if (fn.type === "selector_expression") {
    const field = fn.childForFieldName("field");
    if (field) return field.text;
  }
  return undefined;
}

/** Pass 4：提取函数调用（call_expression） */
export function extractCalls(root: SyntaxNode): CallExpression[] {
  const out: CallExpression[] = [];
  walk(root, (n) => {
    if (n.type !=="call_expression") return;
    const calleeName = calleeNameOf(n);
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
 * Pass 5：提取非调用引用（类型引用）。
 * Go 无 JSX，引用来自类型标识符（type_identifier）：
 * - 结构体字段类型 / 方法接收者类型 / 参数与返回值类型 / 局部变量类型 / 类型嵌入等
 * 统一记为 refKind='type'，按 (name,line,enclosing) 去重降噪。
 */
export function extractRefs(root: SyntaxNode): Reference[] {
  const out: Reference[] = [];
  const seen = new Set<string>();
  walk(root, (n) => {
    if (n.type !== "type_identifier") return;
    const name = n.text;
    const line = startLine(n);
    const enclosing = enclosingSymbolName(n);
    const key = `${name}:${line}:${enclosing ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(
      enclosing === undefined
        ? { name, line, refKind: "type" }
        : { name, line, enclosingSymbol: enclosing, refKind: "type" },
    );
  });
  return out;
}

export const goAdapter: LanguageAdapter = {
  id: "go",
  extensions: [".go"],
  grammarFor(_filePath: string): GrammarId {
    return "go";
  },
  extractExports: (tree: Tree) => extractExports(tree.rootNode),
  extractInternalSymbols: (tree: Tree) => extractInternalSymbols(tree.rootNode),
  extractImports: (tree: Tree) => extractImports(tree.rootNode),
  extractCalls: (tree: Tree) => extractCalls(tree.rootNode),
  extractRefs: (tree: Tree) => extractRefs(tree.rootNode),
};