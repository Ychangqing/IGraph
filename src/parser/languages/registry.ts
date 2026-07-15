/**
 * parser/languages/registry.ts — 语言适配器接口与注册表
 *
 * 设计（对应规划 5.1 语言适配器接口）：
 * - LanguageAdapter 抽象每种语言的 5-Pass 提取逻辑，便于 Phase 2 增加 Python/Java。
 * - 按扩展名注册；file-scanner 用 detectLanguage 判断文件是否可解析。
 */
import type { Tree } from "tree-sitter";
import type {
  CallExpression,
  ExportedSymbol,
  ImportStatement,
  InternalSymbol,
  Reference,
} from "../../types/index.js";
import type { GrammarId } from "../tree-sitter.js";

/** 语言适配器：每种语言实现 5-Pass 的符号/关系提取 */
export interface LanguageAdapter {
  /** 语言标识，如 'typescript' */
  id: string;
  /** 处理的文件扩展名（含点），如 ['.ts', '.tsx'] */
  extensions: string[];
  /** 依据文件路径选择 tree-sitter grammar（TS 与 TSX 语法不同） */
  grammarFor(filePath: string): GrammarId;

  /** Pass 1：提取导出符号 */
  extractExports(tree: Tree, sourceCode: string): ExportedSymbol[];
  /** Pass 2：提取内部（非导出）顶层符号 */
  extractInternalSymbols(tree: Tree, sourceCode: string): InternalSymbol[];
  /** Pass 3：解析 import / require */
  extractImports(tree: Tree, sourceCode: string): ImportStatement[];
  /** Pass 4：提取函数调用 */
  extractCalls(tree: Tree, sourceCode: string): CallExpression[];
  /** Pass 5：提取非调用引用（类型引用 / JSX 组件） */
  extractRefs(tree: Tree, sourceCode: string): Reference[];
}

/** 扩展名（小写，含点） → 适配器 */
const extensionMap = new Map<string, LanguageAdapter>();
/** 语言 id → 适配器 */
const idMap = new Map<string, LanguageAdapter>();

/** 注册一个语言适配器 */
export function registerAdapter(adapter: LanguageAdapter): void {
  idMap.set(adapter.id, adapter);
  for (const ext of adapter.extensions) {
    extensionMap.set(ext.toLowerCase(), adapter);
  }
}

/** 取文件扩展名（小写，含点）；无扩展名返回 '' */
function extname(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

/**
 * 依据文件路径返回语言 id；不支持的扩展名返回 undefined。
 * file-scanner 用它筛掉无法解析的文件。
 */
export function detectLanguage(filePath: string): string | undefined {
  const adapter = extensionMap.get(extname(filePath));
  return adapter?.id;
}

/** 依据文件路径返回适配器；不支持返回 undefined */
export function getAdapterForFile(filePath: string): LanguageAdapter | undefined {
  return extensionMap.get(extname(filePath));
}

/** 依据语言 id 返回适配器 */
export function getAdapterById(id: string): LanguageAdapter | undefined {
  return idMap.get(id);
}

/** 清空注册表（测试用） */
export function clearRegistry(): void {
  extensionMap.clear();
  idMap.clear();
}