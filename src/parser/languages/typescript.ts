/**
 * parser/languages/typescript.ts — TypeScript 语言适配器
 *
 * 处理 .ts / .tsx / .mts / .cts。提取逻辑委托给 ast-utils（TS/JS 共享）。
 * .tsx 使用 tsx grammar 以支持 JSX，其余用 typescript grammar。
 */
import type { Tree } from "tree-sitter";
import type { LanguageAdapter } from "./registry.js";
import type { GrammarId } from "../tree-sitter.js";
import {
  extractCalls,
  extractExports,
  extractImports,
  extractInternalSymbols,
  extractRefs,
} from "./ast-utils.js";

export const typescriptAdapter: LanguageAdapter = {
  id: "typescript",
  extensions: [".ts", ".tsx", ".mts", ".cts"],
  grammarFor(filePath: string): GrammarId {
    return filePath.toLowerCase().endsWith(".tsx") ? "tsx" : "typescript";
  },
  extractExports: (tree: Tree) => extractExports(tree.rootNode),
  extractInternalSymbols: (tree: Tree) => extractInternalSymbols(tree.rootNode),
  extractImports: (tree: Tree) => extractImports(tree.rootNode),
  extractCalls: (tree: Tree) => extractCalls(tree.rootNode),
  extractRefs: (tree: Tree) => extractRefs(tree.rootNode),
};