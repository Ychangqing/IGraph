/**
 * semantic/ — 语义化层（LLM 两层摘要 + 断点续传）。M3 里程碑实现。
 *
 * 统一导出 LLM 客户端、Prompt 模板、启发式降级、批量处理器，并提供
 * generateSummaries 作为对外入口：根据模式（llm | heuristic）装配 summarize
 * 回调后驱动批量处理器。
 */
import type { DB } from "../graph/db.js";
import type { FileRow } from "../graph/files.js";
import type { NodeRow } from "../graph/nodes.js";
import { LlmClient, type LlmClientOptions } from "./llm-client.js";
import {
  SYSTEM_PROMPT,
  PROMPT_VERSION,
  buildBatchPrompt,
  parseBatchResponse,
  type PromptSymbol,
} from "./prompts.js";
import { heuristicSummaries, HEURISTIC_MODEL } from "./fallback.js";
import {
  processPendingFiles,
  type BatchOptions,
  type BatchResult,
  type FileSummaryOutput,
  type SummarizeFile,
} from "./batch-processor.js";

export * from "./llm-client.js";
export * from "./prompts.js";
export * from "./fallback.js";
export * from "./batch-processor.js";

/** 将 NodeRow 转为 Prompt / 启发式所需的符号结构 */
function toSymbols(nodes: NodeRow[]): PromptSymbol[] {
  return nodes.map((n) => ({
    name: n.name,
    signature: n.signature ?? "",
    sourceCode: n.source_code ?? "",
  }));
}

/**
 * 构造「启发式」summarize 回调（无需 LLM / 密钥）。
 */
export function createHeuristicSummarizer(): SummarizeFile {
  return (file: FileRow, nodes: NodeRow[]): Promise<FileSummaryOutput> => {
    const symbols = nodes.map((n) => ({
      name: n.name,
      signature: n.signature ?? "",
      isExported: n.is_exported === 1,
    }));
    const result = heuristicSummaries(file.file_path, symbols);
    return Promise.resolve({
      fileSummary: result.fileSummary,
      nodeSummaries: result.nodeSummaries,
      model: HEURISTIC_MODEL,
      promptVersion: PROMPT_VERSION,
    });
  };
}

/**
 * 构造「LLM」summarize 回调。
 * @param client         已初始化的 LLM 客户端
 * @param model          记录到 summary_model 的模型名
 * @param fileSummaryModel 可选，覆盖 file 级（本实现批量调用统一用一个模型，
 *                         若提供则整体使用该更强模型）
 */
export function createLlmSummarizer(
  client: LlmClient,
  model: string,
  fileSummaryModel?: string,
): SummarizeFile {
  const effectiveModel = fileSummaryModel ?? model;
  return async (file: FileRow, nodes: NodeRow[]): Promise<FileSummaryOutput> => {
    const symbols = toSymbols(nodes);
    const userPrompt = buildBatchPrompt({
      filePath: file.file_path,
      symbols,
    });
    const raw = await client.complete({
      model: effectiveModel,
      jsonMode: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });
    const parsed = parseBatchResponse(raw);
    return {
      fileSummary: parsed.fileSummary,
      nodeSummaries: parsed.nodeSummaries,
      model: effectiveModel,
      promptVersion: PROMPT_VERSION,
    };
  };
}

/** generateSummaries 入口选项 */
export interface GenerateSummariesOptions extends BatchOptions {
  /** 'llm' 走 LLM；'heuristic' 走降级模式 */
  mode: "llm" | "heuristic";
  /** mode='llm' 时必填的客户端配置 */
  llm?: LlmClientOptions;
  /** 记录到 summary_model 的默认模型名（llm 模式），默认取 llm.model */
  model?: string;
  /** file 级更强模型（可选） */
  fileSummaryModel?: string;
}

/**
 * 摘要生成对外入口：按模式装配 summarize 回调并驱动批量处理器。
 * 断点续传由处理器负责（只处理 pending）。
 */
export async function generateSummaries(
  db: DB,
  options: GenerateSummariesOptions,
): Promise<BatchResult> {
  let summarize: SummarizeFile;
  if (options.mode === "heuristic") {
    summarize = createHeuristicSummarizer();
  } else {
    if (!options.llm) {
      throw new Error("generateSummaries: mode='llm' 需要提供 llm 配置");
    }
    const client = new LlmClient(options.llm);
    summarize = createLlmSummarizer(
      client,
      options.model ?? options.llm.model,
      options.fileSummaryModel,
    );
  }

  const batchOptions: BatchOptions = {
    maxConcurrency: options.maxConcurrency,
    handleSigint: options.handleSigint,
    ...(options.onProgress ? { onProgress: options.onProgress} : {}),
  };
  return processPendingFiles(db, summarize, batchOptions);
}