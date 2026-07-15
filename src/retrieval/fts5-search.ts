/**
 * retrieval/fts5-search.ts — FTS5 全文检索通道
 *
 * 封装 nodes_fts（content='nodes'，index 了 name + summary）的 BM25 检索，
 * 作为双通道融合中的稀疏（关键词）通道。
 *
 * 关键点：
 * - FTS5 的 MATCH 表达式对用户原始输入敏感（双引号、AND/OR/NEAR、列过滤符
 *   等均为保留语法）。为避免用户自然语言查询触发语法错误，这里把查询拆成
 *   词元并逐个用双引号包裹后以 OR 连接，得到一个安全的 FTS5 表达式。
 * - nodes_fts 使用 trigram（三元组）分词器（见 schema.ts），使中文/英文的
 *   子串匹配均生效。但 trigram 无法为长度 <3 的词元生成任何 token，因此
 *   "溯源"（2 汉字）、"ab"（2 字母）这类短查询无法通过 MATCH 命中；对这些
 *   短词元用 LIKE 子串扫描兜底补齐，保证中文短查询的召回。
 * - bm25(nodes_fts) 返回值越小越相关（sqlite FTS5 rank 惯例），故按其升序。
 * - 返回结果携带 0 基 rank（排名位次），供上层 RRF 融合直接使用。
 */
import type { DB } from "../graph/db.js";

/** trigram 分词器可索引的最小词元长度（<该长度需 LIKE 兜底） */
const TRIGRAM_MIN_LEN = 3;

/** FTS5 检索的一条命中 */
export interface FtsHit {
  /** 命中节点 id（= nodes.id = nodes_fts.rowid） */
  nodeId: number;
  /** bm25 分数（越小越相关；LIKE 兜底命中记为 0，排在 MATCH 命中之后） */
  score: number;
  /** 0 基排名位次（0 为最相关） */
  rank: number;
}

/** 从用户输入提取 Unicode 字母/数字/下划线词元 */
function tokenize(query: string): string[] {
  return query.match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/**
 * 将任意用户输入转义为安全的 FTS5 MATCH 表达式（仅纳入长度 ≥3 的词元）。
 *
 * 策略：提取 Unicode 字母/数字/下划线组成的词元，过滤掉 trigram 无法索引的
 * 短词元（<3 字符），剩余词元逐个用双引号包裹（内部双引号转义为两个双引号），
 * 以 OR 连接。无可用词元时返回 null（调用方应转向 LIKE 兜底或空结果）。
 */
export function toFtsMatchExpr(query: string): string | null {
  const tokens = tokenize(query).filter((t) => t.length >= TRIGRAM_MIN_LEN);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

/**
 * FTS5 检索：返回按 BM25 相关性升序排列的命中节点。
 *
 * 分两段召回并合并：
 * 1. MATCH：对 ≥3 字符词元走 trigram FTS 索引，按 bm25 升序。
 * 2. LIKE 兜底：对 <3 字符的短词元（trigram 无法索引，如中文"溯源"），
 *    在 nodes.name / nodes.summary 上做子串扫描补齐；仅补充 MATCH 未覆盖
 *    的节点，追加到 MATCH 命中之后。
 *
 * @param db    数据库句柄
 * @param query 用户原始查询字符串（内部会转义为安全 MATCH 表达式）
 * @param limit 返回上限
 */
export function searchFts(db: DB, query: string, limit: number): FtsHit[] {
  if (limit <= 0) return [];

  const allTokens = tokenize(query);
  if (allTokens.length === 0) return [];

  const seen = new Set<number>();
  const hits: FtsHit[] = [];

  // 1) MATCH 通道（≥3 字符词元，走 trigram FTS 索引）
  const expr = toFtsMatchExpr(query);
  if (expr !== null) {
    const rows = db
      .prepare(
        "SELECT f.rowid AS nodeId, bm25(nodes_fts) AS score " +
          "FROM nodes_fts f WHERE nodes_fts MATCH ? ORDER BY score LIMIT ?",
      )
      .all(expr, limit) as Array<{ nodeId: number; score: number }>;
    for (const r of rows) {
      if (seen.has(r.nodeId)) continue;
      seen.add(r.nodeId);
      hits.push({ nodeId: r.nodeId, score: r.score, rank: hits.length });
      if (hits.length >= limit) return hits;
    }
  }

  // 2) LIKE 兜底通道（<3 字符短词元，trigram 无法索引）
  const shortTokens = [
    ...new Set(allTokens.filter((t) => t.length < TRIGRAM_MIN_LEN)),
  ];
  if (shortTokens.length > 0 && hits.length < limit) {
    const clauses = shortTokens
      .map(() => "(name LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')")
      .join(" OR ");
    const params: string[] = [];
    for (const t of shortTokens) {
      const pat = `%${escapeLike(t)}%`;
      params.push(pat, pat);
    }
    const rows = db
      .prepare(
        `SELECT id AS nodeId FROM nodes WHERE ${clauses} ORDER BY id LIMIT ?`,
      )
      .all(...params, limit) as Array<{ nodeId: number }>;
    for (const r of rows) {
      if (seen.has(r.nodeId)) continue;
      seen.add(r.nodeId);
      // LIKE 兜底命中无 bm25 分数，记为 0（排在 MATCH 命中之后，rank 递增）
      hits.push({ nodeId: r.nodeId, score: 0, rank: hits.length });
      if (hits.length >= limit) break;
    }
  }

  return hits;
}

/** 转义 LIKE 通配符（% _ \），配合 ESCAPE '\\' 使用，避免子串中通配符误匹配 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}