/**
 * parser/languages/ast-utils.ts — TS/JS 共享的 AST 提取工具
 *
 * 供 typescript / javascript 适配器复用。JS 与 TS 的 tree-sitter 节点类型高度重合
 * （function_declaration / lexical_declaration / class_declaration / import_statement 等），
 * 因此提取逻辑集中在此，两个适配器差异仅在 grammar 选择与扩展名。
 */
import type { SyntaxNode } from "tree-sitter";
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
/** 1-based 结束行 */
function endLine(node: SyntaxNode): number {
  return node.endPosition.row + 1;
}

/** React 组件命名约定：大写开头 */
function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}
/** React Hook 命名约定：use 开头 + 大写 */
function isHookName(name: string): boolean {
  return /^use[A-Z]/.test(name);
}

/** 依据函数名归类 function / component / hook */
function classifyFunction(name: string): NodeKind {
  if (isHookName(name)) return "hook";
  if (isComponentName(name)) return "component";
  return "function";
}

/** 取函数签名：参数列表 + 返回类型注解（若有） */
function functionSignature(node: SyntaxNode): string {
  const params = node.childForFieldName("parameters");
  const paramsText = params ? params.text : "()";
  // 返回类型：function_declaration 的 type_annotation 子节点
  let ret = "";
  for (const child of node.namedChildren) {
    if (child.type === "type_annotation") {
      ret = child.text;
      break;
    }
  }
  return `${paramsText}${ret}`.replace(/\s+/g, " ").trim();
}

/** 从 heritage 子句节点取被引用的类型名（处理 generic_type 包裹的泛型） */
function heritageTypeName(node: SyntaxNode): string | undefined {
  if (node.type === "type_identifier" || node.type === "identifier") return node.text;
  if (node.type === "generic_type") {
    const id = node.namedChildren.find(
      (c) => c.type === "type_identifier" || c.type === "identifier",
    );
    return id?.text;
  }
  return undefined;
}

/** 从 class_heritage 提取 extends / implements 名称 */
function extractHeritage(classNode: SyntaxNode): {
  extendsName?: string;
  implementsNames?: string[];
} {
  const heritage = classNode.namedChildren.find((c) => c.type === "class_heritage");
  if (!heritage) return {};
  let extendsName: string | undefined;
  const implementsNames: string[] = [];
  for (const clause of heritage.namedChildren) {
    if (clause.type === "extends_clause") {
      for (const t of clause.namedChildren) {
        const name = heritageTypeName(t);
        if (name) {
          extendsName = name;
          break;
        }
      }
    } else if (clause.type === "implements_clause") {
      for (const t of clause.namedChildren) {
        const name = heritageTypeName(t);
        if (name) implementsNames.push(name);
      }
    }
  }
  const result: { extendsName?: string; implementsNames?: string[] } = {};
  if (extendsName) result.extendsName = extendsName;
  if (implementsNames.length > 0) result.implementsNames = implementsNames;
  return result;
}

/** variable_declarator 是否为函数（箭头/函数表达式），返回该函数节点或 undefined */
function functionOfDeclarator(declarator: SyntaxNode): SyntaxNode | undefined {
  const value = declarator.childForFieldName("value");
  if (value && (value.type === "arrow_function" || value.type === "function_expression")) {
    return value;
  }
  return undefined;
}

/** 内部通用符号形状（导出与非导出共用字段） */
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

/**
 * 从声明节点提取符号（function_declaration / class_declaration /
 * lexical_declaration|variable_declaration / interface_declaration / type_alias_declaration）。
 * @param decl 声明节点
 * @param wrapper 用于取源码与行号的外层节点（export 时为 export_statement）
 */
function symbolsFromDeclaration(decl: SyntaxNode, wrapper: SyntaxNode): RawSymbol[] {
  const src = wrapper.text;
  const sl = startLine(wrapper);
  const el = endLine(wrapper);

  switch (decl.type) {
    case "function_declaration":
    case "generator_function_declaration": {
      const nameNode = decl.childForFieldName("name");
      const name = nameNode ? nameNode.text : "default";
      return [
        {
          name,
          kind: classifyFunction(name),
          signature: functionSignature(decl),
          startLine: sl,
          endLine: el,
          sourceCode: src,
        },
      ];
    }
    case "class_declaration":
    case "abstract_class_declaration": {
      const nameNode = decl.childForFieldName("name");
      const name = nameNode ? nameNode.text : "default";
      return [
        {
          name,
          kind: isComponentName(name) ? "component" : "class",
          signature: `class ${name}`,
          startLine: sl,
          endLine: el,
          sourceCode: src,
          ...extractHeritage(decl),
        },
      ];
    }
    case "interface_declaration":
    case "type_alias_declaration": {
      const nameNode = decl.childForFieldName("name") ?? decl.namedChildren[0];
      const name = nameNode ? nameNode.text : "default";
      return [
        {
          name,
          kind: "type",
          signature: decl.type === "interface_declaration" ? `interface ${name}` : `type ${name}`,
          startLine: sl,
          endLine: el,
          sourceCode: src,
        },
      ];
    }
    case "lexical_declaration":
    case "variable_declaration": {
      const out: RawSymbol[] = [];
      for (const d of decl.namedChildren) {
        if (d.type !== "variable_declarator") continue;
        const nameNode = d.childForFieldName("name");
        if (!nameNode || nameNode.type !== "identifier") continue;
        const name = nameNode.text;
        const fn = functionOfDeclarator(d);
        out.push({
          name,
          kind: fn ? classifyFunction(name) : "variable",
          signature: fn ? functionSignature(fn) : `const ${name}`,
          startLine: sl,
          endLine: el,
          sourceCode: src,
        });
      }
      return out;
    }
    default:
      return [];
  }
}

/** Pass 1：提取导出符号 */
export function extractExports(root: SyntaxNode): ExportedSymbol[] {
  const out: ExportedSymbol[] = [];
  for (const stmt of root.namedChildren) {
    if (stmt.type !== "export_statement") continue;
    const isDefault = stmt.children.some((c) => c.type === "default");

    // export { a, b } from './x'  或  export { a, b }（re-export / 聚合导出）
    const clause = stmt.namedChildren.find((c) => c.type === "export_clause");
    if (clause) {
      for (const spec of clause.namedChildren) {
        if (spec.type !== "export_specifier") continue;
        const nameNode = spec.childForFieldName("name") ?? spec.namedChildren[0];
        if (!nameNode) continue;
        out.push({
          name: nameNode.text,
          kind: "variable",
          signature: `export ${nameNode.text}`,
          startLine: startLine(stmt),
          endLine: endLine(stmt),
          sourceCode: stmt.text,
          isDefault: false,
        });
      }
      continue;
    }

    // export <declaration>
    const decl = stmt.namedChildren.find((c) =>
      [
        "function_declaration",
        "generator_function_declaration",
        "class_declaration",
        "abstract_class_declaration",
        "lexical_declaration",
        "variable_declaration",
        "interface_declaration",
        "type_alias_declaration",
      ].includes(c.type),
    );
    if (!decl) continue;
    for (const sym of symbolsFromDeclaration(decl, stmt)) {
      out.push({ ...sym, isDefault });
    }
  }
  return out;
}

/** Pass 2：提取内部（非导出）顶层符号 */
export function extractInternalSymbols(root: SyntaxNode): InternalSymbol[] {
  const out: InternalSymbol[] = [];
  for (const stmt of root.namedChildren) {
    // 仅顶层、非 export 声明
    if (
      ![
        "function_declaration",
        "generator_function_declaration",
        "class_declaration",
        "abstract_class_declaration",
        "lexical_declaration",
        "variable_declaration",
        "interface_declaration",
        "type_alias_declaration",
      ].includes(stmt.type)
    ) {
      continue;
    }
    for (const sym of symbolsFromDeclaration(stmt, stmt)) {
      out.push(sym);
    }
  }
  return out;
}

/** 取 import_statement 里的模块说明符（去引号） */
function moduleSpecifierOf(node: SyntaxNode): string | undefined {
  const str = node.namedChildren.find((c) => c.type === "string");
  if (!str) return undefined;
  const frag = str.namedChildren.find((c) => c.type === "string_fragment");
  return frag ? frag.text : str.text.replace(/^['"`]|['"`]$/g, "");
}

/** Pass 3：解析 import / require */
export function extractImports(root: SyntaxNode): ImportStatement[] {
  const out: ImportStatement[] = [];
  for (const stmt of root.namedChildren) {
    // ── ES import ──
    if (stmt.type === "import_statement") {
      const spec = moduleSpecifierOf(stmt);
      if (!spec) continue;
      const line = startLine(stmt);
      const clause = stmt.namedChildren.find((c) => c.type === "import_clause");
      if (!clause) {
        // 副作用导入 import './x' —— 记为 namespace 无绑定
        out.push({ moduleSpecifier: spec, kind: "namespace", bindings: [], line });
        continue;
      }
      for (const part of clause.namedChildren) {
        if (part.type === "identifier") {
          // default import
          out.push({
            moduleSpecifier: spec,
            kind: "default",
            bindings: [{ imported: "default", local: part.text }],
            line,
          });
        } else if (part.type === "namespace_import") {
          const id = part.namedChildren.find((c) => c.type === "identifier");
          out.push({
            moduleSpecifier: spec,
            kind: "namespace",
            bindings: id ? [{ imported: "*", local: id.text }] : [],
            line,
          });
        } else if (part.type === "named_imports") {
          const bindings: Array<{ imported: string; local: string }> = [];
          for (const s of part.namedChildren) {
            if (s.type !== "import_specifier") continue;
            const nameNode = s.childForFieldName("name") ?? s.namedChildren[0];
            const aliasNode = s.childForFieldName("alias");
            if (!nameNode) continue;
            bindings.push({
              imported: nameNode.text,
              local: aliasNode ? aliasNode.text : nameNode.text,
            });
          }
          if (bindings.length > 0) {
            out.push({ moduleSpecifier: spec, kind: "named", bindings, line });
          }
        }
      }
      continue;
    }

    // ── CommonJS require: const x = require('./y') ──
    if (stmt.type === "lexical_declaration" || stmt.type === "variable_declaration") {
      for (const d of stmt.namedChildren) {
        if (d.type !== "variable_declarator") continue;
        const value = d.childForFieldName("value");
        if (!value || value.type !== "call_expression") continue;
        const fn = value.childForFieldName("function");
        if (!fn || fn.text !== "require") continue;
        const args = value.childForFieldName("arguments");
        const strArg = args?.namedChildren.find((c) => c.type === "string");
        if (!strArg) continue;
        const spec = strArg.namedChildren.find((c) => c.type === "string_fragment")?.text
          ?? strArg.text.replace(/^['"`]|['"`]$/g, "");
        const nameNode = d.childForFieldName("name");
        out.push({
          moduleSpecifier: spec,
          kind: "require",
          bindings: nameNode ? [{ imported: "default", local: nameNode.text }] : [],
          line: startLine(stmt),
        });
      }
    }
  }
  return out;
}

/**
 * 找到某节点所属的顶层符号名（用于 caller / enclosing）。
 * 向上回溯到 program 的直接子声明，取其符号名。
 */
function enclosingSymbolName(node: SyntaxNode): string | undefined {
  let cur: SyntaxNode | null = node;
  while (cur && cur.parent && cur.parent.type !== "program") {
    cur = cur.parent;
  }
  if (!cur) return undefined;
  // cur 现在是 program 的直接子节点
  let decl = cur;
  if (decl.type === "export_statement") {
    const inner = decl.namedChildren.find((c) =>
      [
        "function_declaration",
        "generator_function_declaration",
        "class_declaration",
        "abstract_class_declaration",
        "lexical_declaration",
        "variable_declaration",
      ].includes(c.type),
    );
    if (inner) decl = inner;
  }
  const nameNode = decl.childForFieldName("name");
  if (nameNode) return nameNode.text;
  if (decl.type === "lexical_declaration" || decl.type === "variable_declaration") {
    const d = decl.namedChildren.find((c) => c.type === "variable_declarator");
    const n = d?.childForFieldName("name");
    if (n && n.type === "identifier") return n.text;
  }
  return undefined;
}

/** 深度遍历所有后代节点 */
function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}

/** Pass 4：提取函数调用 */
export function extractCalls(root: SyntaxNode): CallExpression[] {
  const out: CallExpression[] = [];
  walk(root, (n) => {
    if (n.type !== "call_expression") return;
    const fn = n.childForFieldName("function");
    if (!fn) return;
    let calleeName: string | undefined;
    if (fn.type === "identifier") {
      calleeName = fn.text;
    } else if (fn.type === "member_expression") {
      // a.b() → 取属性名 b
      const prop = fn.childForFieldName("property");
      if (prop) calleeName = prop.text;
    }
    if (!calleeName || calleeName === "require") return;
    const enclosing = enclosingSymbolName(n);
    out.push(
      enclosing === undefined
        ? { calleeName, line: startLine(n) }
        : { calleeName, line: startLine(n), enclosingSymbol: enclosing },
    );
  });
  return out;
}

/** Pass 5：提取非调用引用（类型引用 type_identifier / JSX 组件） */
export function extractRefs(root: SyntaxNode): Reference[] {
  const out: Reference[] = [];
  walk(root, (n) => {
    // 类型引用：type_identifier（排除声明自身的名字由 enclosing 逻辑天然规避）
    if (n.type === "type_identifier") {
      const enclosing = enclosingSymbolName(n);
      out.push(
        enclosing === undefined
          ? { name: n.text, line: startLine(n), refKind: "type" }
          : { name: n.text, line: startLine(n), enclosingSymbol: enclosing, refKind: "type" },
      );
      return;
    }
    // JSX 组件：<MyComponent /> 或 <MyComponent> —— 取标签名且首字母大写
    if (n.type === "jsx_opening_element" || n.type === "jsx_self_closing_element") {
      const id = n.namedChildren.find(
        (c) => c.type === "identifier" || c.type === "member_expression",
      );
      if (id && /^[A-Z]/.test(id.text)) {
        const enclosing = enclosingSymbolName(n);
        out.push(
          enclosing === undefined
            ? { name: id.text, line: startLine(n), refKind: "jsx" }
            : { name: id.text, line: startLine(n), enclosingSymbol: enclosing, refKind: "jsx" },
        );
      }
    }
  });
  return out;
}