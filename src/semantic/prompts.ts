/**
 * semantic/prompts.ts — 摘要 Prompt 模板与版本管理
 *
 * 对应规划 5.2 节。核心是「批量 Prompt」：一次 LLM 调用同时生成 file 级摘要
 * 与该文件下所有 node 的摘要，以 JSON 结构化输出，降低调用次数。
 *
 * 版本管理：PROMPT_VERSION 与配置 llm.promptVersion 齐，用于摘要版本追踪
 * （写入 files/nodes 的 summary_prompt_ver）。修改模板务必同步 bump 版本号。
 */

/** 当前 Prompt 模板版本号 */
export const PROMPT_VERSION = "v1.0";

/** 参与批量摘要的单个符号（构造 Prompt 用） */
export interface PromptSymbol {
  name: string;
  signature: string;
  /** 函数/类体源码（可截断） */
  sourceCode: string;
}

/** 批量摘要 Prompt 的输入 */
export interface BatchPromptInput {
  filePath: string;
  symbols: PromptSymbol[];
}

/** 系统提示：约束输出为严格 JSON，使用中文摘要 */
export const SYSTEM_PROMPT =
  "你是资深代码分析助手。请用简洁中文为代码文件及其符号生成一句话摘要，" +
  "并严格按要求的 JSON 结构输出，不要输出任何额外解释或 Markdown 代码块围栏。";

/** 单个符号源码在 Prompt 中的最大字符数（防止超 token） */
const MAX_SYMBOL_SOURCE_CHARS = 1200;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n/* …（源码已截断）*/";
}

/**
 * 构造批量摘要的用户 Prompt。
 * 要求模型返回：
 *   {
 *     "file_summary": "模块名：核心功能",
 *     "nodes": [ { "name": "...", "summary": "..." }, ... ]
 *   }
 */
export function buildBatchPrompt(input: BatchPromptInput): string {
  const symbolsBlock = input.symbols
    .map((s) => {
      const body = truncate(s.sourceCode, MAX_SYMBOL_SOURCE_CHARS);
      return [
        `### ${s.name}`,
        `签名：${s.signature || "(无)"}`,
        "源码：",
        body,
      ].join("\n");
    })
    .join("\n\n");

  return `请为以下代码文件及其符号生成摘要。

文件路径：${input.filePath}

要求：
1. file_summary 用「{模块名称}：{核心功能，用顿号分隔}」格式，一句话概括文件职责。
2. 每个 node 的 summary 用「{动词}{宾语}{补充说明}」格式，一句话概括其作用。
3. nodes 数组必须覆盖下方列出的每一个符号名，且 name 完全一致。

请严格按以下 JSON 格式输出（不要含围栏、不要多余字段）：
{
  "file_summary": "模块名：核心功能",
  "nodes": [
    { "name": "符号名", "summary": "一句话描述" }
  ]
}

符号列表：
${symbolsBlock}`;
}

/** 解析后的批量摘要结果 */
export interface ParsedBatchSummary {
  fileSummary: string;
  /** name → summary */
  nodeSummaries: Map<string, string>;
}

/**
 * 解析 LLM 返回的 JSON 文本为结构化摘要。
 * 容错：允许响应被 ```json 围栏包裹或含前后空白。
 * 解析失败或结构非法时抛错，供上层归类为该文件处理失败。
 */
export function parseBatchResponse(raw: string): ParsedBatchSummary {
  const cleaned = stripCodeFence(raw).trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`摘要 JSON 解析失败：${(err as Error).message}`);
  }
  if (typeof obj !== "object" || obj === null) {
    throw new Error("摘要响应不是 JSON 对象");
  }
  const record = obj as Record<string, unknown>;
  const fileSummary = record["file_summary"];
  if (typeof fileSummary !== "string") {
    throw new Error("摘要响应缺少字符串字段 file_summary");
  }
  const nodeSummaries = new Map<string, string>();
  const nodes = record["nodes"];
  if (Array.isArray(nodes)) {
    for (const item of nodes) {
      if (typeof item !== "object" || item === null) continue;
      const n = item as Record<string, unknown>;
      const name = n["name"];
      const summary = n["summary"];
      if (typeof name === "string" && typeof summary === "string") {
        nodeSummaries.set(name, summary);
      }
    }
  }
  return { fileSummary, nodeSummaries };
}

/** 去除可能存在的 ```json ... ``` 围栏 */
function stripCodeFence(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenceMatch && fenceMatch[1] !== undefined ? fenceMatch[1] : text;
}