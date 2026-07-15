/**
 * vector/store.ts — sqlite-vec 向量存储封装
 *
 * 封装 vec0 虚拟表（file_vectors / node_vectors）的 upsert / delete / search。
 *
 * 关键点：
 * - 向量以 Float32Array 序列化为 BLOB 写入（sqlite-vec 原生支持 Float32 buffer）。
 * - vec0 默认距离度量为 L2（欧氏距离）。BGE-M3 输出为 L2 归一化向量，此时
 *   L2² = 2·(1 − cosine)，故余弦相似度可由距离换算：
 *     cosineSimilarity = 1 − distance² / 2
 *   （对未归一化向量该换算不精确，但检索排序仅依赖距离单调性，不受影响；
 *    相似度值用于 fallback 阈值判定与结果展示。）
 * - better-sqlite3 命名/位置参数不可混用：本模块统一用位置参数。
 * - sqlite-vec 的 vec0 INTEGER PRIMARY KEY 绑定要求传入 JS BigInt，普通 number
 *   会被拒绝（报 "Only integers are allows for primary key values"）。故本模块
 *   写入 / 过滤主键时统一用 BigInt(id)；查询返回的主键再经 Number(...) 归一。
 */
import type { DB } from "../graph/db.js";

/** 向量表名 */
export type VectorTable = "file_vectors" | "node_vectors" | "resource_vectors";

/** 各表的主键列名 */
const KEY_COLUMN: Record<VectorTable, string> = {
  file_vectors: "file_id",
  node_vectors: "node_id",
  resource_vectors: "resource_id",
};

/** 一条向量搜索命中 */
export interface VectorHit {
  /** 主键 id（file_id / node_id / resource_id） */
  id: number;
  /** vec0 返回的 L2 距离（越小越相似） */
  distance: number;
  /** 由距离换算的余弦相似度（归一化向量下精确），范围约 [-1, 1] */
  similarity: number;
}

/** 将 number[] 序列化为 sqlite-vec 可接受的 Float32 BLOB */
export function serializeVector(vec: readonly number[]): Buffer {
  const f32 = Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

/** L2 距离 → 余弦相似度（假设向量已归一化） */
export function distanceToSimilarity(distance: number): number {
  return 1 - (distance * distance) / 2;
}

/**
 * upsert 单条向量。vec0 不支持 ON CONFLICT，故先 DELETE 再 INSERT，保证幂等。
 */
export function upsertVector(
  db: DB,
  table: VectorTable,
  id: number,
  vector: readonly number[],
): void {
  const key = KEY_COLUMN[table];
  const blob = serializeVector(vector);
  const pk = BigInt(id);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`).run(pk);
    db.prepare(`INSERT INTO ${table}(${key}, embedding) VALUES (?, ?)`).run(pk, blob);
  });
  tx();
}

/** 批量 upsert 向量（单事务） */
export function upsertVectors(
  db: DB,
  table: VectorTable,
  entries: ReadonlyArray<{ id: number; vector: readonly number[] }>,
): void {
  const key = KEY_COLUMN[table];
  const del = db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`);
  const ins = db.prepare(`INSERT INTO ${table}(${key}, embedding) VALUES (?, ?)`);
  const tx = db.transaction((rows: ReadonlyArray<{ id: number; vector: readonly number[] }>) => {
    for (const row of rows) {
      const pk = BigInt(row.id);
      del.run(pk);
      ins.run(pk, serializeVector(row.vector));
    }
  });
  tx(entries);
}

/** 删除单条向量 */
export function deleteVector(db: DB, table: VectorTable, id: number): void {
  const key = KEY_COLUMN[table];
  db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`).run(BigInt(id));
}

/**
 * 读回单条向量（vec0 的 embedding 以 vec_to_json 反序列化为 number[]）。
 * 供增量刷新复用已落库的资源向量做重新建边，避免重复调用 Embedding API。
 * 不存在或解析失败时返回 undefined。
 */
export function getVector(
  db: DB,
  table: VectorTable,
  id: number,
): number[] | undefined {
  const key = KEY_COLUMN[table];
  const row = db
    .prepare(`SELECT vec_to_json(embedding) AS json FROM ${table} WHERE ${key} = ?`)
    .get(BigInt(id)) as { json: string } | undefined;
  if (row === undefined) return undefined;
  try {
    const parsed = JSON.parse(row.json) as number[];
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** 统计向量条数 */
export function countVectors(db: DB, table: VectorTable): number {
  return db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;
}

/**
 * KNN 搜索：返回与 query 向量最近的 topK 条（按距离升序）。
 *
 * 使用 vec0 的 KNN 语法：`WHERE embedding MATCH ? AND k = ?`。
 */
export function searchVectors(
  db: DB,
  table: VectorTable,
  query: readonly number[],
  topK: number,
): VectorHit[] {
  if (topK <= 0) return [];
  const key = KEY_COLUMN[table];
  const blob = serializeVector(query);
  const rows = db
    .prepare(
      `SELECT ${key} AS id, distance FROM ${table} ` +
        `WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
    )
    .all(blob, topK) as Array<{ id: number | bigint; distance: number }>;
  return rows.map((r) => ({
    id: Number(r.id),
    distance: r.distance,
    similarity: distanceToSimilarity(r.distance),
  }));
}

/**
 * 候选子集大小阈值：超过此值时 searchVectorsWithin 放弃 IN 子句过滤，
 * 改为全量 KNN 后在应用层用候选 Set 过滤，避免超长 IN 列表触及 SQL 变量上限
 * （SQLITE_MAX_VARIABLE_NUMBER）或产生过大的逐行扫描开销。
 */
export const WITHIN_CANDIDATE_THRESHOLD = 200;

/**
 * 在指定 id 子集内做 KNN 搜索（两级检索第二级：命中文件内的 node）。
 *
 * vec0 的 KNN（MATCH ... AND k）不支持与任意 WHERE 谓词组合过滤子集，
 * 故此处对候选子集全量计算 L2 距离后在应用层排序取 topK。子集通常较小
 * （粗筛命中文件内的节点），性能可接受。
 *
 * 当候选子集大小超过 WITHIN_CANDIDATE_THRESHOLD 时，改为全量 KNN 检索
 * （不带候选 IN 过滤），再在应用层用候选 id 集合过滤结果，规避超长 IN
 * 列表带来的 SQL 变量上限 / 性能问题。
 */
export function searchVectorsWithin(
  db: DB,
  table: VectorTable,
  query: readonly number[],
  ids: readonly number[],
  topK: number,
): VectorHit[] {
  if (topK <= 0 || ids.length === 0) return [];
  const key = KEY_COLUMN[table];

  // 候选集过大：fallback 全量 KNN，再用候选 Set 在应用层过滤。
  if (ids.length > WITHIN_CANDIDATE_THRESHOLD) {
    const candidateSet = new Set<number>(ids.map((v) => Number(v)));
    // 全量 KNN 的 k 至少覆盖整表，确保过滤后仍能凑够 topK。
    const total = countVectors(db, table);
    const knn = searchVectors(db, table, query, Math.max(total, topK));
    const filtered: VectorHit[] = [];
    for (const hit of knn) {
      if (candidateSet.has(hit.id)) {
        filtered.push(hit);
        if (filtered.length >= topK) break;
      }
    }
    return filtered;
  }

  const blob = serializeVector(query);
  const placeholders = ids.map(() => "?").join(", ");
  // vec_distance_l2 是 sqlite-vec 提供的标量函数，可对任意子集逐行计算距离。
  const rows = db
    .prepare(
      `SELECT ${key} AS id, vec_distance_l2(embedding, ?) AS distance ` +
        `FROM ${table} WHERE ${key} IN (${placeholders}) ` +
        `ORDER BY distance LIMIT ?`,
    )
    .all(blob, ...ids.map((v) => BigInt(v)), topK) as Array<{
      id: number | bigint;
      distance: number;
    }>;
  return rows.map((r) => ({
    id: Number(r.id),
    distance: r.distance,
    similarity: distanceToSimilarity(r.distance),
  }));
}