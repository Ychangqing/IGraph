/**
 * types/tree-sitter.d.ts — tree-sitter 及语言包的最小类型声明
 *
 * tree-sitter / tree-sitter-typescript / tree-sitter-javascript 未随包发布
 * 完整的 .d.ts。这里补充 M1 解析器实际用到的最小 API 子集，保证 strict 编译通过。
 */
declare module "tree-sitter" {
  export interface Point {
    row: number;
    column: number;
  }

  export interface SyntaxNode {
    type: string;
    text: string;
    startPosition: Point;
    endPosition: Point;
    startIndex: number;
    endIndex: number;
    childCount: number;
    namedChildCount: number;
    children: SyntaxNode[];
    namedChildren: SyntaxNode[];
    parent: SyntaxNode | null;
    child(index: number): SyntaxNode | null;
    namedChild(index: number): SyntaxNode | null;
    childForFieldName(fieldName: string): SyntaxNode | null;
    descendantsOfType(type: string | string[]): SyntaxNode[];
  }

  export interface Tree {
    rootNode: SyntaxNode;
  }

  // tree-sitter Language 对象为不透明原生绑定
  export type Language = unknown;

  export default class Parser {
    setLanguage(language: Language): void;
    parse(input: string): Tree;
  }
}

declare module "tree-sitter-typescript" {
  import type { Language } from "tree-sitter";
  const bindings: {
    typescript: Language;
    tsx: Language;
  };
  export default bindings;
}

declare module "tree-sitter-javascript" {
  import type { Language } from "tree-sitter";
  const javascript: Language;
  export default javascript;
}

declare module "tree-sitter-python" {
  import type { Language } from "tree-sitter";
  // tree-sitter-python 0.21.x 的默认导出为 { name, language, nodeTypeInfo }，
  // 与 tree-sitter-javascript 同形。tree-sitter 的 setLanguage 直接接收该模块对象
  // （内部读取其 .language/.nodeTypeInfo 构建节点子类），故按 Language 类型对待，
  // 与 javascript 模块声明保持一致。
  const python: Language;
  export default python;
}

declare module "tree-sitter-java" {
  import type { Language } from "tree-sitter";
  // tree-sitter-java 0.23.x 的默认导出为模块对象（含 name/language/nodeTypeInfo），
  // 与 tree-sitter-python / tree-sitter-javascript 同形。tree-sitter 的 setLanguage
  // 直接接收该模块对象（内部读取 .language/.nodeTypeInfo），故按 Language 类型对待，
  // 严禁传 .language 以避免 native ABI 崩溃（Invalid language object / 段错误）。
  const java: Language;
  export default java;
}

declare module "tree-sitter-go" {
  import type { Language } from "tree-sitter";
  // tree-sitter-go 0.23.x 的默认导出为模块对象（含 name/language/nodeTypeInfo），
  // 与 tree-sitter-java / tree-sitter-python 同形。tree-sitter 的 setLanguage
  // 直接接收该模块对象（内部读取 .language/.nodeTypeInfo），故按 Language 类型对待，
  // 严禁传 .language 以避免 native ABI 崩溃（Invalid language object / 段错误）。
  const go: Language;
  export default go;
}