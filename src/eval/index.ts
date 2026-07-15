/**
 * eval/index.ts — 评测系统入口（Recall@K / MRR / 端到端闭环）
 *
 * 职责：
 * 1. 读取评测数据集 queries.json（格式见 EvalCase / 规划 5.7 节）。
 * 2. 逐条调用「现有检索链」：search（Dense+FTS5 RRF）→ graph-expand → formatter，
 *    复用 M4 已有能力，不重写检索逻辑。RRF 融合为硬约束。
 * 3. 计算指标并生成报告。
 *
 * 优雅降级（关键需求）：
 * - 当数据库无 node 向量（--no-llm 构建）或未配置 IGRAPH_API_KEY 无法向量化
 *   query 时，自动降级为「仅 FTS5 通道」检索（searchFtsOnly，仍走 RRF），
 *   评测照常跑通，不崩溃，并在报告 note 中说明。
 *
 * 检索链通过依赖注入（RetrieveFn）抽象，便于单测注入 mock。
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { DB } from "../graph/db.js";
import { countVectors } from "../vector/store.js";
import { EmbeddingClient } from "../vector/embedding-client.js";
import type { ResolvedConfig } from "../config/schema.js";
import { search, searchFtsOnly, type SearchResponse } from "../retrieval/search.js";
import { formatResult } from "../retrieval/formatter.js";
import {
  aggregateReport,
  evaluateCase,
  type CaseMetric,
  type EvalCase,
  type EvalReport,
  type RankedResult,
} from "./metrics.js";
import { renderReport, type ReportContext } from "./reporter.js";

export * from "./metrics.js";
export * from "./reporter.js";

/** 检索模式 */
export type RetrievalMode = "dense+fts5" | "fts5-only";

/** 单条 query 的检索函数签名（返回统一的 SearchResponse） */
export type RetrieveFn = (query: string) => Promise<SearchResponse> | SearchResponse;

/** 评测运行选项 */
export interface RunEvalOptions {
  /** 已打开并含图谱数据的数据库 */
  db: DB;
  /** 运行时配置（含 retrieval 参数与凭据） */
  config: ResolvedConfig;
  /** 评测样本 */
  cases: readonly EvalCase[];
  /** Recall@K 的 K，默认取 retrieval.nodeTopK */
  k?: number;
  /** 可注入的检索函数（测试用）；不传则内部构建 */
  retrieveFn?: RetrieveFn;
  /** 强制检索模式（测试用）；不传则自动探测 */
  forceMode?: RetrievalMode;
}

/** 评测运行结果 */
export interface RunEvalResult {
  report: EvalReport;
  mode: RetrievalMode;
  /** 降级说明（未降级为 undefined） */
  note?: string;
}

/** 从磁盘读取 queries.json 并校验基本结构 */
export function loadEvalCases(path: string): EvalCase[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(`读取评测数据集失败（${path}）：${(err as Error).message}`);
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { queries?: unknown })?.queries)
      ? (parsed as { queries: unknown[] }).queries
      : null;
  if (arr === null) {
    throw new Error(
      `评测数据集格式错误（${path}）：应为数组或含 queries 数组的对象`,
    );
  }
  return arr.map((raw, i) => {
    const o = raw as Record<string, unknown>;
    if (typeof o.query !== "string" || o.query.trim() === "") {
      throw new Error(`第 ${i} 条样本缺少合法的 query 字段`);
    }
    const expectedNodes = Array.isArray(o.expected_nodes)
      ? (o.expected_nodes as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const expectedFiles = Array.isArray(o.expected_files)
      ? (o.expected_files as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    return {
      query: o.query,
      expected_nodes: expectedNodes,
      expected_files: expectedFiles,
    };
  });
}

/**
 * 决定检索模式并构建检索函数。
 *
 * 优先 Dense+FTS5（需 node 向量存在 且 有 API Key）；否则降级 fts5-only。
 */
function buildRetriever(
  db: DB,
  config: ResolvedConfig,
  limit: number,
  forceMode?: RetrievalMode,
): { mode: RetrievalMode; retrieve: RetrieveFn; note?: string } {
  const hasVectors = countVectors(db, "node_vectors") > 0;
  const hasApiKey = config.credentials.apiKey.trim() !== "";
  const canDense = hasVectors && hasApiKey;

  const mode: RetrievalMode =
    forceMode ?? (canDense ? "dense+fts5" : "fts5-only");

  if (mode === "fts5-only") {
    const reason = !hasVectors
      ? "数据库无 node 向量（可能以 --no-llm 构建）"
      : "未配置 IGRAPH_API_KEY，无法向量化 query";
    return {
      mode,
      note: `无 Embedding 服务，已降级为仅 FTS5 通道检索（RRF 融合，dense 通道为空）；原因：${reason}`,
      retrieve: (query: string) =>
        searchFtsOnly(db, query, { retrieval: config.retrieval, limit }),
    };
  }

  const client = new EmbeddingClient({
    baseURL: config.credentials.embeddingBaseURL ?? config.embedding.baseURL,
    model: config.embedding.model,
    apiKey: config.credentials.apiKey,
    dimensions: config.embedding.dimensions,
    batchSize: config.embedding.batchSize,
  });
  return {
    mode,
    retrieve: (query: string) =>
      search(db, client, query, { retrieval: config.retrieval, limit }),
  };
}

/**
 * 运行评测：逐条检索 → 计时 → 计算指标 → 聚合报告。
 */
export async function runEval(options: RunEvalOptions): Promise<RunEvalResult> {
  const { db, config, cases } = options;
  const k = options.k ?? config.retrieval.nodeTopK;
  const limit = Math.max(k, config.retrieval.nodeTopK);

  let mode: RetrievalMode;
  let retrieve: RetrieveFn;
  let note: string | undefined;

  if (options.retrieveFn) {
    mode = options.forceMode ?? "dense+fts5";
    retrieve = options.retrieveFn;
  } else {
    const built = buildRetriever(db, config, limit, options.forceMode);
    mode = built.mode;
    retrieve = built.retrieve;
    note = built.note;
  }

  const caseMetrics: CaseMetric[] = [];
  for (const c of cases) {
    const start = performance.now();
    const response = await retrieve(c.query);
    const elapsedMs = performance.now() - start;

    // 复用 formatter 把结果统一为「名称 + 文件路径」供指标层比较。
    const formatted = formatResult(db, c.query, response, []);
    const ranked: RankedResult[] = formatted.hits.map((h) => ({
      name: h.name,
      filePath: h.filePath,
    }));

    const empty = c.expected_nodes.length === 0;
    const { recall, reciprocalRank, firstHitRank } = evaluateCase(
      ranked,
      c.expected_nodes,
      k,
    );
    caseMetrics.push({
      query: c.query,
      recall,
      reciprocalRank,
      firstHitRank,
      elapsedMs,
      empty,
    });
  }

  const report = aggregateReport(caseMetrics, k);
  return note === undefined ? { report, mode } : { report, mode, note };
}

/** 便捷：运行评测并返回渲染好的终端报告文本 */
export async function runEvalAndRender(
  options: RunEvalOptions,
  reportCtx: ReportContext = {},
): Promise<{ result: RunEvalResult; text: string }> {
  const result = await runEval(options);
  const ctx: ReportContext = { ...reportCtx, mode: result.mode };
  if (result.note !== undefined) ctx.note = result.note;
  const text = renderReport(result.report, ctx);
  return { result, text };
}