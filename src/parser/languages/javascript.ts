/**
 * parser/languages/javascript.ts — JavaScript 语言适配器
 *
 * 处理 .js / .jsx / .mjs / .cjs。JS 与 TS 的 tree-sitter 节点类型高度重合，
 * 提取逻辑复用 ast-utils。所有 JS 变体统一使用 javascript grammar（含 JSX）。
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

export const javascriptAdapter: LanguageAdapter = {
  id: "javascript",
  extensions: [".js", ".jsx", ".mjs", ".cjs"],
  grammarFor(_filePath: string): GrammarId {
    return "javascript";
  },
  extractExports: (tree: Tree) => extractExports(tree.rootNode),
  extractInternalSymbols: (tree: Tree) => extractInternalSymbols(tree.rootNode),
  extractImports: (tree:Tree) => extractImports(tree.rootNode),
  extractCalls: (tree: Tree) => extractCalls(tree.rootNode),
  extractRefs: (tree: Tree) => extractRefs(tree.rootNode),
};