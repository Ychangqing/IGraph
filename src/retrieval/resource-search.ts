/**
 * retrieval/resource-search.ts — 独立资源检索通道
 *
 * 直接对 resource_vectors 做 KNN + 对 resources 表做 LIKE 子串匹配，
 * 让无代码关联（无 resource_edges）的 PRD/DB 资源也能被检索召回。
 *
 * 设计要点：
 * - Dense 通道复用 vector/store.ts 的 searchVectors 对 resource_vectors 做 KNN。
 * - FTS 通道对 resources 表的 name + summary 列做 LIKE 子串扫描
 *   （resources 量级小，无需新建 FTS5 虚拟表，避免 schema 迁移）。
 * - 两通道按 resourceId 去重合并：Dense 在前，FTS 补充未覆盖的。
 * - 降级：queryVec 为 null 时仅走 FTS 通道。
 */
import type { DB } from "../graph/db.js";
import { searchVectors, countVectors } from "../vector/store.js";

/** 资源检索命中 */
export interface ResourceSearchHit {
  resourceId: number;
  /** Dense 命中有值，FTS 命中为 null */
  similarity: number | null;
  matchChannel: "dense" | "fts";
}

/**
 * Dense 通道：KNN 搜索 resource_vectors。
 */
function searchResourceDense(
  db: DB,
  queryVec: readonly number[],
  topK: number,
): ResourceSearchHit[] {
  if (countVectors(db, "resource_vectors") === 0) return [];
  const hits = searchVectors(db, "resource_vectors", queryVec, topK);
  return hits.map((h) => ({
    resourceId: h.id,
    similarity: h.similarity,
    matchChannel: "dense" as const,
  }));
}

/**
 * FTS 通道：LIKE 子串匹配 resources.name + resources.summary。
 *
 * resources 表量级远小于 nodes（通常几十到几百条），直接 LIKE 扫描性能可接受。
 */
function searchResourceFts(
  db: DB,
  query: string,
  topK: number,
): ResourceSearchHit[] {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (tokens.length === 0) return [];

  const clauses = tokens
    .map(() => "(name LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')")
    .join(" OR ");
  const params: string[] = [];
  for (const t of tokens) {
    const pat = `%${escapeLike(t)}%`;
    params.push(pat, pat);
  }

  const rows = db
    .prepare(
      `SELECT id FROM resources WHERE ${clauses} ORDER BY id LIMIT ?`,
    )
    .all(...params, topK) as Array<{ id: number }>;

  return rows.map((r) => ({
    resourceId: r.id,
    similarity: null,
    matchChannel: "fts" as const,
  }));
}

/** 转义 LIKE 通配符 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * 独立资源检索：合并 Dense + FTS 两通道，按 resourceId 去重。
 *
 * @param db       数据库
 * @param queryVec query 向量（null 时仅走 FTS）
 * @param query    原始查询字符串
 * @param topK     返回上限
 */
export function searchResources(
  db: DB,
  queryVec: readonly number[] | null,
  query: string,
  topK: number,
): ResourceSearchHit[] {
  const seen = new Set<number>();
  const results: ResourceSearchHit[] = [];

  // Dense 通道优先
  if (queryVec !== null) {
    const denseHits = searchResourceDense(db, queryVec, topK);
    for (const h of denseHits) {
      if (!seen.has(h.resourceId)) {
        seen.add(h.resourceId);
        results.push(h);
      }
    }
  }

  // FTS 通道补充
  if (results.length < topK) {
    const ftsHits = searchResourceFts(db, query, topK);
    for (const h of ftsHits) {
      if (results.length >= topK) break;
      if (!seen.has(h.resourceId)) {
        seen.add(h.resourceId);
        results.push(h);
      }
    }
  }

  return results.slice(0, topK);
}
