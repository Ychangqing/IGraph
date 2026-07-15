/**
 * retrieval/search.ts — 两级检索 + 双通道 RRF 融合 + fallback
 *
 * 检索流程（对应 M4 检索核心）：
 * 1. 将 query 文本经 EmbeddingClient 向量化，得到 query 向量。
 * 2. 粗筛（文件级）：在 file_vectors 上 KNN 取 fileTopK 个候选文件。
 * 3. 精排（节点级）：
 *    a. Dense 通道——在「候选文件所含节点」子集内做向量 KNN，取 nodeTopK。
 *    b. FTS5 通道——对 query 做 BM25 全文检索，取 nodeTopK。
 *    c. 用 RRF 融合两个通道的排名（禁止加权线性合并）。
 * 4. Fallback：若融合结果为空，或 Dense 最高相似度 < fallbackThreshold，
 *    则退化为「全量 node 向量检索」补充/兜底，保证召回。
 *
 * 依赖注入：EmbeddingClient 可替换为 mock，便于测试与离线。
 */
import type { DB } from "../graph/db.js";
import { getNodesByFile } from "../graph/nodes.js";
import type { RetrievalConfig } from "../config/schema.js";
import type { EmbeddingClient } from "../vector/embedding-client.js";
import {
  searchVectors,
  searchVectorsWithin,
  type VectorHit,
} from "../vector/store.js";
import { searchFts } from "./fts5-search.js";
import { fuseRrf, type MergedResult } from "./dual-channel.js";

/** 检索结果（融合结果 + Dense 相似度信息） */
export interface SearchResult extends MergedResult {
  /** 该节点在 Dense 通道的余弦相似度（未命中 Dense 为 null） */
  denseSimilarity: number | null;
}

/** 检索诊断信息（供调试 / 输出层展示） */
export interface SearchDiagnostics {
  /** 粗筛命中的文件 id */
  candidateFileIds: number[];
  /** Dense 通道最高相似度（无命中为 null） */
  maxDenseSimilarity: number | null;
  /** 是否触发了 fallback 全量向量检索 */
  fallbackTriggered: boolean;
}

/** 检索的完整返回 */
export interface SearchResponse {
  results: SearchResult[];
  diagnostics: SearchDiagnostics;
  /** 向量化后的 query vector（供下游复用，避免重复 embed） */
  queryVec?: readonly number[];
}

/** 检索选项 */
export interface SearchOptions {
  /** 检索配置（topK / 阈值 / RRF 参数） */
  retrieval: RetrievalConfig;
  /** 最终返回条数上限，默认取 retrieval.nodeTopK */
  limit?: number;
}

/** 将 VectorHit[] 转为 id → similarity 映射 */
function toSimilarityMap(hits: readonly VectorHit[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const h of hits) m.set(h.id, h.similarity);
  return m;
}

/**
 * 执行一次检索。
 *
 * @param db      已迁移并含向量的数据库
 * @param client  Embedding 客户端（用于查询向量化，可注入 mock）
 * @param query   自然语言查询
 * @param options 检索配置与上限
 */
export async function search(
  db: DB,
  client: EmbeddingClient,
  query: string,
  options: SearchOptions,
): Promise<SearchResponse> {
  const cfg = options.retrieval;
  const limit = options.limit ?? cfg.nodeTopK;

  const queryVec = await client.embedOne(query);

  // ── 1. 粗筛：文件级向量 KNN ──
  const fileHits = searchVectors(db, "file_vectors", queryVec, cfg.fileTopK);
  const candidateFileIds = fileHits.map((h) => h.id);

  // ── 2a. Dense 通道：候选文件内节点向量精排 ──
  const candidateNodeIds = collectNodeIds(db, candidateFileIds);
  let denseHits = searchVectorsWithin(
    db,
    "node_vectors",
    queryVec,
    candidateNodeIds,
    cfg.nodeTopK,
  );

  // ── 2b. FTS5 通道：BM25 全文检索 ──
  const ftsHits = searchFts(db, query, cfg.nodeTopK);

  // ── 3. Fallback 判定 ──
  const maxDenseSim = denseHits.length > 0 ? (denseHits[0]?.similarity ?? null) : null;
  const denseWeak =
    maxDenseSim === null || maxDenseSim < cfg.fallbackThreshold;
  const mergedEmpty = denseHits.length === 0 && ftsHits.length === 0;
  const fallbackTriggered = mergedEmpty || denseWeak;

  if (fallbackTriggered) {
    // 全量 node 向量检索兜底：不受候选文件子集限制。
    const globalHits = searchVectors(db, "node_vectors", queryVec, cfg.nodeTopK);
    denseHits = mergeVectorHits(denseHits, globalHits, cfg.nodeTopK);
  }

  // ── 4. RRF 融合 ──
  const denseRanked = denseHits.map((h) => h.id);
  const ftsRanked = ftsHits.map((h) => h.nodeId);
  const merged = fuseRrf(denseRanked, ftsRanked, {
    rrfK: cfg.rrfK,
    denseWeight: cfg.denseWeight,
    ftsWeight: cfg.ftsWeight,
    limit,
  });

  const simMap = toSimilarityMap(denseHits);
  const results: SearchResult[] = merged.map((m) => ({
    ...m,
    denseSimilarity: simMap.get(m.nodeId) ?? null,
  }));

  return {
    results,
    diagnostics: {
      candidateFileIds,
      maxDenseSimilarity: maxDenseSim,
      fallbackTriggered,
    },
    queryVec,
  };
}

/**
 * 仅 FTS5 通道的降级检索（无 Embedding 服务时使用）。
 *
 * 场景：`--no-llm` 构建或未配置 IGRAPH_API_KEY 时数据库无向量，query 无法
 * 向量化。此时优雅降级为「仅 BM25 全文检索」，并仍通过 RRF 融合（dense 通道
 * 传空数组）产出统一的 SearchResponse，符合「检索链必须走 RRF」的硬约束。
 *
 * 不依赖 EmbeddingClient，不做任何网络调用，保证离线可跑通、不崩溃。
 */
export function searchFtsOnly(
  db: DB,
  query: string,
  options: SearchOptions,
): SearchResponse {
  const cfg = options.retrieval;
  const limit = options.limit ?? cfg.nodeTopK;

  const ftsHits = searchFts(db, query, cfg.nodeTopK);
  const ftsRanked = ftsHits.map((h) => h.nodeId);

  // Dense 通道为空数组 → RRF 退化为仅 FTS5 通道贡献，仍走 fuseRrf。
  const merged = fuseRrf([], ftsRanked, {
    rrfK: cfg.rrfK,
    denseWeight: cfg.denseWeight,
    ftsWeight: cfg.ftsWeight,
    limit,
  });

  const results: SearchResult[] = merged.map((m) => ({
    ...m,
    denseSimilarity: null,
  }));

  return {
    results,
    diagnostics: {
      candidateFileIds: [],
      maxDenseSimilarity: null,
      // 无 Dense 通道即视为已进入降级路径。
      fallbackTriggered: true,
    },
  };
}

/** 收集候选文件下的全部节点 id（去重，保持顺序） */
function collectNodeIds(db: DB, fileIds: readonly number[]): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const fid of fileIds) {
    for (const n of getNodesByFile(db, fid)) {
      if (!seen.has(n.id)) {
        seen.add(n.id);
        ids.push(n.id);
      }
    }
  }
  return ids;
}

/**
 * 合并两组向量命中并按距离升序去重取 topK。
 * 用于 fallback 时把子集精排结果与全量结果合流。
 */
function mergeVectorHits(
  a: readonly VectorHit[],
  b: readonly VectorHit[],
  topK: number,
): VectorHit[] {
  const best = new Map<number, VectorHit>();
  for (const h of [...a, ...b]) {
    const prev = best.get(h.id);
    if (prev === undefined || h.distance < prev.distance) best.set(h.id, h);
  }
  return [...best.values()]
    .sort((x, y) => x.distance - y.distance)
    .slice(0, topK);
}