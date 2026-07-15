/**
 * graph/resources.ts — resources 表与 resource_edges 表 CRUD（M7 多模态）
 *
 * resources 表记录多模态资源切片（PRD 需求点 / DB 表等），每条切片是一个
 * 独立可向量化的语义单元 {type, source_path, name, content, summary, hash}。
 * resource_edges 表记录资源切片与代码文件（files）之间的关联边，携带
 * 相似度 / 置信度 / 链接强度（strong/weak）三项由置信度分级写入。
 *
 * 与 files/nodes 的向量化不同：resource 向量落在 resource_vectors（vec0），
 * 由 multimodal/index.ts 在挂载时直接 upsert（复用 vector/store.ts 封装，
 * 主键 BigInt 处理已在 store 内完成，勿在此绕过）。
 */
import type { DB } from "./db.js";

/** 资源类型（MVP：prd / db） */
export type ResourceType = "prd" | "db";

/** resource_edges.kind：PRD→describes，DB→reads */
export type ResourceEdgeKind = "describes" | "reads";

/** 链接强度分级 */
export type LinkType = "strong" | "weak";

/** resources 表完整行（可空字段用 null） */
export interface ResourceRow {
  id: number;
  type: string;
  source_path: string | null;
  name: string;
  content: string | null;
  summary: string | null;
  hash: string | null;
  created_at: string;
  updated_at: string;
}

/** 插入 resources 的入参 */
export interface ResourceInput {
  type: ResourceType;
  sourcePath?: string | null;
  name: string;
  content?: string | null;
  summary?: string | null;
  hash?: string | null;
}

/** resource_edges 表完整行 */
export interface ResourceEdgeRow {
  id: number;
  resource_id: number;
  file_id: number;
  kind: string;
  similarity: number | null;
  confidence: number;
  link_type: string;
  created_at: string;
}

/** upsert resource_edges 的入参 */
export interface ResourceEdgeInput {
  resourceId: number;
  fileId: number;
  kind: ResourceEdgeKind;
  similarity: number;
  confidence: number;
  linkType: LinkType;
}

/**
 * 插入一条资源切片，返回自增 id。
 */
export function insertResource(db: DB, input: ResourceInput): number {
  const info = db
    .prepare(
      "INSERT INTO resources(type, source_path, name, content, summary, hash) " +
        "VALUES (@type, @sourcePath, @name, @content, @summary, @hash)",
    )
    .run({
      type: input.type,
      sourcePath: input.sourcePath ?? null,
      name: input.name,
      content: input.content ?? null,
      summary: input.summary ?? null,
      hash: input.hash ?? null,
    });
  return Number(info.lastInsertRowid);
}

/** 批量插入资源切片（单事务），返回自增 id 列表（与入参顺序对应） */
export function insertResources(
  db: DB,
  inputs: readonly ResourceInput[],
): number[] {
  const ids: number[] = [];
  const tx = db.transaction((rows: readonly ResourceInput[]) => {
    for (const row of rows) ids.push(insertResource(db, row));
  });
  tx(inputs);
  return ids;
}

/** 按 id 查询资源，不存在返回 undefined */
export function getResourceById(db: DB, id: number): ResourceRow | undefined {
  return db.prepare("SELECT * FROM resources WHERE id = ?").get(id) as
    | ResourceRow
    | undefined;
}

/** 按类型列出资源 */
export function listResourcesByType(
  db: DB,
  type: ResourceType,
): ResourceRow[] {
  return db
    .prepare("SELECT * FROM resources WHERE type = ? ORDER BY id")
    .all(type) as ResourceRow[];
}

/** 列出全部资源切片（增量刷新时遍历重建其到文件的关联边） */
export function listResources(db: DB): ResourceRow[] {
  return db
    .prepare("SELECT * FROM resources ORDER BY id")
    .all() as ResourceRow[];
}

/** 统计资源总数（可选按类型） */
export function countResources(db: DB, type?: ResourceType): number {
  if (type === undefined) {
    return db.prepare("SELECT count(*) FROM resources").pluck().get() as number;
  }
  return db
    .prepare("SELECT count(*) FROM resources WHERE type = ?")
    .pluck()
    .get(type) as number;
}

/** 删除指定来源路径的所有资源（重复挂载时先清理旧数据，级联删除其边） */
export function deleteResourcesBySource(db: DB, sourcePath: string): number {
  const info = db
    .prepare("DELETE FROM resources WHERE source_path = ?")
    .run(sourcePath);
  return info.changes;
}

/**
 * upsert 一条资源边：按 (resource_id, file_id, kind) 唯一约束插入或更新。
 * 冲突时更新 similarity/confidence/link_type。
 */
export function upsertResourceEdge(db: DB, input: ResourceEdgeInput): void {
  db.prepare(
    "INSERT INTO resource_edges(resource_id, file_id, kind, similarity, confidence, link_type) " +
      "VALUES (@resourceId, @fileId, @kind, @similarity, @confidence, @linkType) " +
      "ON CONFLICT(resource_id, file_id, kind) DO UPDATE SET " +
      "similarity = excluded.similarity, confidence = excluded.confidence, " +
      "link_type = excluded.link_type",
  ).run({
    resourceId: input.resourceId,
    fileId: input.fileId,
    kind: input.kind,
    similarity: input.similarity,
    confidence: input.confidence,
    linkType: input.linkType,
  });
}

/** 批量 upsert 资源边（单事务），返回写入条数 */
export function upsertResourceEdges(
  db: DB,
  inputs: readonly ResourceEdgeInput[],
): number {
  const tx = db.transaction((rows: readonly ResourceEdgeInput[]) => {
    for (const row of rows) upsertResourceEdge(db, row);
  });
  tx(inputs);
  return inputs.length;
}

/** 列出某文件关联的所有资源边（供检索展开时带出 PRD/DB 上下文） */
export function listResourceEdgesByFile(
  db: DB,
  fileId: number,
): ResourceEdgeRow[] {
  return db
    .prepare(
      "SELECT * FROM resource_edges WHERE file_id = ? ORDER BY confidence DESC, id",
    )
    .all(fileId) as ResourceEdgeRow[];
}

/** 列出某资源关联的所有边 */
export function listResourceEdgesByResource(
  db: DB,
  resourceId: number,
): ResourceEdgeRow[] {
  return db
    .prepare(
      "SELECT * FROM resource_edges WHERE resource_id = ? ORDER BY confidence DESC, id",
    )
    .all(resourceId) as ResourceEdgeRow[];
}

/** 统计资源边总数 */
export function countResourceEdges(db: DB): number {
  return db.prepare("SELECT count(*) FROM resource_edges").pluck().get() as number;
}

/**
 * 删除指向某文件的所有资源边（增量刷新：文件内容变化后其向量已更新，
 * 需先清除旧的关联边，再由 linker 依据新向量重新建边），返回删除条数。
 */
export function deleteResourceEdgesByFile(db: DB, fileId: number): number {
  const info = db
    .prepare("DELETE FROM resource_edges WHERE file_id = ?")
    .run(fileId);
  return info.changes;
}