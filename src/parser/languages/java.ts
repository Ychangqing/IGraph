/**
 * parser/languages/java.ts — Java 语言适配器
 *
 * 处理 .java。与 Python 的下划线私有约定不同，Java 用 `public` 修饰符判定导出：
 * - class / interface / enum / method / field 带 public → 导出（is_exported=true）；
 *   否则视为内部符号（package-private / protected / private 一律 internal）。
 *
 * 提取风格与其它适配器保持一致：1-based 行号、endPosition 定 end_line、
 * 顶层（类型）符号 + 类型体内成员（method/field）一并收集为符号；
 * 深度遍历收集 method_invocation（calls）与 type_identifier（refs）。
 *
 * tree-sitter-java 关键节点：
 * - 顶层：class_declaration / interface_declaration / enum_declaration /
 *   import_declaration / package_declaration
 * - 成员：field_declaration(variable_declarator) / method_declaration
 * - 修饰符：modifiers 子节点，文本含 public/private/... 及注解
 * - 调用：method_invocation（name 字段=方法名，object 字段=接收者）
 * - 类型引用：type_identifier / generic_type
 * - 继承：superclass > type_identifier；super_interfaces > type_list > type_identifier
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

/** 顶层类型声明节点类型 */
const TYPE_DECLS = new Set([
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
]);

/** 从声明节点的 modifiers 判定是否含 public（无 modifiers 视为 package-private，非导出） */
function isPublic(decl: SyntaxNode): boolean {
  const modifiers = decl.namedChildren.find((c) => c.type === "modifiers");
  if (!modifiers) return false;
  // modifiers.text 形如 "public static"；用词边界匹配 public 关键字
  return /\bpublic\b/.test(modifiers.text);
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
  extendsName?: string;
  implementsNames?: string[];
}

/** class 的 kind 映射：class/enum → class；interface → type */
function typeDeclKind(declType: string): NodeKind {
  if (declType === "interface_declaration") return "type";
  return "class";
}

/** 从 superclass / super_interfaces 提取继承信息 */
function extractHeritage(decl: SyntaxNode): {
  extendsName?: string;
  implementsNames?: string[];
} {
  const result: { extendsName?: string; implementsNames?: string[] } = {};
  const superclass = decl.namedChildren.find((c) => c.type === "superclass");
  if (superclass) {
    const t = superclass.descendantsOfType("type_identifier")[0];
    if (t) result.extendsName = t.text;
  }
  // interface_declaration 的父接口用 extends_interfaces；class 用 super_interfaces
  const interfaces = decl.namedChildren.find(
    (c) => c.type === "super_interfaces" || c.type === "extends_interfaces",
  );
  if (interfaces) {
    const names = interfaces.descendantsOfType("type_identifier").map((t) => t.text);
    if (names.length > 0) {
      // interface extends 多个父接口时，第一个作 extendsName，其余作 implementsNames
      if (decl.type === "interface_declaration" && !result.extendsName) {
        result.extendsName = names[0];
        if (names.length > 1) result.implementsNames = names.slice(1);
      } else {
        result.implementsNames = names;
      }
    }
  }
  return result;
}

/** 方法签名：形参列表 + 返回类型 */
function methodSignature(decl: SyntaxNode): string {
  const params = decl.childForFieldName("parameters");
  const paramsText = params ? params.text : "()";
  const ret = decl.childForFieldName("type");
  const retText = ret ? `: ${ret.text}` : "";
  return `${paramsText}${retText}`.replace(/\s+/g, " ").trim();
}

/** 从类型体（class_body / interface_body / enum_body）收集成员符号 */
function collectMembers(bodyNode: SyntaxNode): RawSymbol[] {
  const out: RawSymbol[] = [];
  for (const member of bodyNode.namedChildren) {
    if (member.type === "method_declaration") {
      const nameNode = member.childForFieldName("name");
      if (!nameNode) continue;
      out.push({
        name: nameNode.text,
        kind: "method",
        signature: methodSignature(member),
        startLine: startLine(member),
        endLine: endLine(member),
        sourceCode: member.text,
        isExported: isPublic(member),
      });
    } else if (member.type === "field_declaration") {
      // 一条 field_declaration 可声明多个变量：public int a, b;
      const exported = isPublic(member);
      for (const decl of member.namedChildren) {
        if (decl.type !== "variable_declarator") continue;
        const nameNode = decl.childForFieldName("name");
        if (!nameNode) continue;
        out.push({
          name: nameNode.text,
          kind: "variable",
          signature: member.text.replace(/\s+/g, " ").trim(),
          startLine: startLine(member),
          endLine: endLine(member),
          sourceCode: member.text,
          isExported: exported,
        });
      }
    }
  }
  return out;
}

/** 类型体字段名（class_declaration→class_body 等） */
function bodyOf(decl: SyntaxNode): SyntaxNode | undefined {
  return (
    decl.childForFieldName("body") ??
    decl.namedChildren.find(
      (c) =>
        c.type === "class_body" ||
        c.type === "interface_body" ||
        c.type === "enum_body",
    )
  );
}

/** 收集顶层类型声明及其成员的原始符号 */
function collectSymbols(root: SyntaxNode): RawSymbol[] {
  const out: RawSymbol[] = [];
  for (const stmt of root.namedChildren) {
    if (!TYPE_DECLS.has(stmt.type)) continue;
    const nameNode = stmt.childForFieldName("name");
    if (!nameNode) continue;
    const name = nameNode.text;
    const kind = typeDeclKind(stmt.type);
    const keyword =
      stmt.type === "interface_declaration"
        ? "interface"
        : stmt.type === "enum_declaration"
          ? "enum"
          : "class";
    out.push({
      name,
      kind,
      signature: `${keyword} ${name}`,
      startLine: startLine(stmt),
      endLine: endLine(stmt),
      sourceCode: stmt.text,
      isExported: isPublic(stmt),
      ...extractHeritage(stmt),
    });
    // 成员
    const body = bodyOf(stmt);
    if (body) out.push(...collectMembers(body));
  }
  return out;
}

/** Pass 1：提取导出符号（public） */
export function extractExports(root: SyntaxNode): ExportedSymbol[] {
  const out: ExportedSymbol[] = [];
  for (const sym of collectSymbols(root)) {
    if (!sym.isExported) continue;
    const { isExported: _drop, ...rest } = sym;
    out.push({ ...rest, isDefault: false });
  }
  return out;
}

/** Pass 2：提取内部（非 public）符号 */
export function extractInternalSymbols(root: SyntaxNode): InternalSymbol[] {
  const out: InternalSymbol[] = [];
  for (const sym of collectSymbols(root)) {
    if (sym.isExported) continue;
    const { isExported: _drop, ...rest } = sym;
    out.push(rest);
  }
  return out;
}

/** Pass 3：解析 import 声明（含 static import；Java 无相对导入） */
export function extractImports(root: SyntaxNode): ImportStatement[] {
  const out: ImportStatement[] = [];
  for (const stmt of root.namedChildren) {
    if (stmt.type !== "import_declaration") continue;
    const line = startLine(stmt);
    // scoped_identifier: 完整限定名，如 java.util.List / java.util.*
    const scoped = stmt.namedChildren.find(
      (c) => c.type === "scoped_identifier" || c.type === "identifier",
    );
    if (!scoped) continue;
    const spec = scoped.text;
    // import java.util.*; 会带一个 asterisk（非 named 子节点为 * token）
    const isWildcard = /\.\*\s*;?\s*$/.test(stmt.text);
    if (isWildcard) {
      out.push({
        moduleSpecifier: spec,
        kind: "namespace",
        bindings: [{ imported: "*", local: "*" }],
        line,
      });
      continue;
    }
    // 取最末段作为 imported/local 名（java.util.List → List）
    const local = spec.slice(spec.lastIndexOf(".") + 1);
    out.push({
      moduleSpecifier: spec,
      kind: "named",
      bindings: [{ imported: local, local }],
      line,
    });
  }
  return out;
}

/** 深度遍历所有后代节点 */
function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}

/**
 * 找到某节点所属的最近方法/类型符号名（caller / enclosing）。
 * 向上回溯，优先取 method_declaration 名，其次取类型声明名。
 */
function enclosingSymbolName(node: SyntaxNode): string | undefined {
  let cur: SyntaxNode | null = node.parent;
  while (cur) {
    if (cur.type === "method_declaration") {
      const n = cur.childForFieldName("name");
      if (n) return n.text;
    }
    if (TYPE_DECLS.has(cur.type)) {
      const n = cur.childForFieldName("name");
      if (n) return n.text;
    }
    cur = cur.parent;
  }
  return undefined;
}

/** Pass 4：提取方法调用（method_invocation） */
export function extractCalls(root: SyntaxNode): CallExpression[] {
  const out: CallExpression[] = [];
  walk(root, (n) => {
    if (n.type !== "method_invocation") return;
    const nameNode = n.childForFieldName("name");
    if (!nameNode) return;
    const calleeName = nameNode.text;
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
 * Java 无 JSX，引用来自类型标识符（type_identifier）：
 * - 继承基类 / 实现接口
 * - 字段/方法返回值/参数/局部变量的类型
 * 统一记为 refKind='type'。为降噪，仅收集 type_identifier（跳过 method_invocation 的接收者）。
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

export const javaAdapter: LanguageAdapter = {
  id: "java",
  extensions: [".java"],
  grammarFor(_filePath: string): GrammarId {
    return "java";
  },
  extractExports: (tree: Tree) => extractExports(tree.rootNode),
  extractInternalSymbols: (tree: Tree) => extractInternalSymbols(tree.rootNode),
  extractImports: (tree: Tree) => extractImports(tree.rootNode),
  extractCalls: (tree: Tree) => extractCalls(tree.rootNode),
  extractRefs: (tree: Tree) => extractRefs(tree.rootNode),
};