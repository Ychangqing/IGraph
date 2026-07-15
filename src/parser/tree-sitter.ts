/**
 * parser/tree-sitter.ts — Tree-sitter 初始化与解析
 *
 * 职责：
 * - 懒加载 tree-sitter 原生绑定与 TS/JS/TSX grammar。
 * - 缓存每种语言对应的 Parser 实例（Parser 非线程安全，但本工具单线程串行解析，
 *   复用实例可避免重复 setLanguage 开销）。
 * - 对外提供 parse(sourceCode, grammar) → Tree。
 *
 * 兼容性：tree-sitter 为 Node 原生插件（需 Node 18+ / N-API）。若加载失败，
 * 抛出可读错误提示重新安装依赖。
 */
import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import JavaScript from "tree-sitter-javascript";
import Python from "tree-sitter-python";
import Java from "tree-sitter-java";
import Go from "tree-sitter-go";
import type { Language, Tree } from "tree-sitter";

/** 支持的 grammar 标识 */
export type GrammarId = "typescript" | "tsx" | "javascript" | "python" | "java" | "go";

/** grammar → tree-sitter Language 映射 */
function resolveLanguage(grammar: GrammarId): Language {
  switch (grammar) {
    case "typescript":
      return TypeScript.typescript;
    case "tsx":
      return TypeScript.tsx;
    case "javascript":
      return JavaScript;
    case "python":
      // tree-sitter-python 0.21.x 默认导出为模块对象（含 language/nodeTypeInfo），
      // 与 tree-sitter-javascript 同形，直接交给 setLanguage。
      return Python;
    case "java":
      // tree-sitter-java 0.23.x 默认导出为模块对象（含 language/nodeTypeInfo），
      // 与 python/javascript 同形，直接交给 setLanguage，严禁传 .language。
      return Java;
    case "go":
      // tree-sitter-go 0.23.x 默认导出为模块对象（含 language/nodeTypeInfo），
      // 与 java/python/javascript 同形，直接交给 setLanguage，严禁传 .language
      // 以避免 native ABI 崩溃。
      return Go;
    default: {
      // 穷尽性检查
      const never: never = grammar;
      throw new Error(`未知 grammar: ${String(never)}`);
    }
  }
}

/** 每个 grammar 复用一个 Parser 实例 */
const parserCache = new Map<GrammarId, Parser>();

function getParser(grammar: GrammarId): Parser {
  const cached = parserCache.get(grammar);
  if (cached) return cached;
  const parser = new Parser();
  try {
    parser.setLanguage(resolveLanguage(grammar));
  } catch (err) {
    throw new Error(
      `加载 tree-sitter grammar「${grammar}」失败：${(err as Error).message}。` +
        `请确认已安装 tree-sitter / tree-sitter-typescript / tree-sitter-javascript / tree-sitter-python（Node 18+）。`,
    );
  }
  parserCache.set(grammar, parser);
  return parser;
}

/**
 * 解析源码为语法树。
 * @param sourceCode 源码文本
 * @param grammar grammar 标识
 */
export function parse(sourceCode: string, grammar: GrammarId): Tree {
  const parser = getParser(grammar);
  return parser.parse(sourceCode);
}

/** 供测试或长驻进程释放缓存 */
export function resetParsers(): void {
  parserCache.clear();
}