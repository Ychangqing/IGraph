/**
 * graph/files.ts — files 表 CRUD
 *
 * files 表以仓库文件为基准，记录路径、语言、内容哈希及摘要 / 向量化状态。
 * M2 阶段仅写入解析期可得字段（file_path / language / hash），摘要与向量
 * 相关字段保持默认（pending），由 M3+ 填充。
 */
import type { DB } from "./db.js";

/** files 表完整行（与 Schema 对齐，可空字段用 null） */
export interface FileRow {
  id: number;
  file_path: string;
  language: string | null;
  hash: string;
  file_summary: string | null;
  summary_status: string;
  summary_model: string | null;
  summary_prompt_ver: string | null;
  summary_updated_at: string | null;
  embedding_status: string;
  embedding_model: string | null;
  created_at: string;
  updated_at: string;
}

/** 插入 / upsert files 的入参（解析期子集） */
export interface FileInput {
  filePath: string;
  language?: string | null;
  hash: string;
}

/**
 * 插入一条文件记录，返回自增 id。
 * file_path 冲突（UNIQUE）时抛错——需要幂等写入请用 upsertFile。
 */
export function insertFile(db: DB, input: FileInput): number {
  const stmt = db.prepare(
    "INSERT INTO files(file_path, language, hash) VALUES (@filePath, @language, @hash)",
  );
  const info = stmt.run({
    filePath: input.filePath,
    language: input.language ?? null,
    hash: input.hash,
  });
  return Number(info.lastInsertRowid);
}

/**
 * upsert：按 file_path 唯一约束插入或更新（更新 language/hash/updated_at）。
 * 返回该文件的 id。
 */
export function upsertFile(db: DB, input: FileInput): number {
  db.prepare(
    "INSERT INTO files(file_path, language, hash) VALUES (@filePath, @language, @hash) " +
      "ON CONFLICT(file_path) DO UPDATE SET " +
      "language = excluded.language, hash = excluded.hash, updated_at = datetime('now')",
  ).run({
    filePath: input.filePath,
    language: input.language ?? null,
    hash: input.hash,
  });
  const id = db
    .prepare("SELECT id FROM files WHERE file_path = ?")
    .pluck()
    .get(input.filePath) as number | undefined;
  if (id === undefined) {
    throw new Error(`upsertFile 后未能读取文件 id：${input.filePath}`);
  }
  return id;
}

/**
 * 批量 upsert 文件，返回 file_path → id 的映射。
 * 全部包裹在单个事务中以提升吞吐。
 */
export function upsertFiles(
  db: DB,
  inputs: readonly FileInput[],
): Map<string, number> {
  const result = new Map<string, number>();
  const tx = db.transaction((rows: readonly FileInput[]) => {
    for (const row of rows) {
      result.set(row.filePath, upsertFile(db, row));
    }
  });
  tx(inputs);
  return result;
}

/** 按 id 查询文件，不存在返回 undefined */
export function getFileById(db: DB, id: number): FileRow | undefined {
  return db.prepare("SELECT * FROM files WHERE id = ?").get(id) as
    | FileRow
    | undefined;
}

/** 按 file_path 查询文件，不存在返回 undefined */
export function getFileByPath(
  db: DB,
  filePath: string,
): FileRow | undefined {
  return db.prepare("SELECT * FROM files WHERE file_path = ?").get(filePath) as
    | FileRow
    | undefined;
}

/** 列出所有文件 */
export function listFiles(db: DB): FileRow[] {
  return db.prepare("SELECT * FROM files ORDER BY id").all() as FileRow[];
}

/** 统计文件总数 */
export function countFiles(db: DB): number {
  return db.prepare("SELECT count(*) FROM files").pluck().get() as number;
}

/** 按 id 删除文件（级联删除其 nodes 及相关 edges） */
export function deleteFile(db: DB, id: number): void {
  db.prepare("DELETE FROM files WHERE id = ?").run(id);
}

/**
 * 重命名文件路径：仅改写 files.file_path（及 updated_at），其关联的 nodes /
 * edges / 向量 / resource_edges 均以 file_id 关联，路径变更不影响这些引用，
 * 因而无需重建，供增量重命名场景使用（内容不变时省去重解析与重向量化）。
 *
 * @returns 是否命中并更新了记录（旧路径不存在时返回 false）
 */
export function updateFilePath(db: DB, from: string, to: string): boolean {
  const info = db
    .prepare(
      "UPDATE files SET file_path = ?, updated_at = datetime('now') WHERE file_path = ?",
    )
    .run(to, from);
  return info.changes > 0;
}

/** 摘要状态取值 */
export type SummaryStatus = "pending" | "done" | "error";

/**
 * 列出摘要状态为指定值的文件（默认 'pending'）。
 * 供 M3 语义化层做断点续传：只处理 pending，跳过 done。
 */
export function listFilesBySummaryStatus(
  db: DB,
  status: SummaryStatus = "pending",
): FileRow[] {
  return db
    .prepare("SELECT * FROM files WHERE summary_status = ? ORDER BY id")
    .all(status) as FileRow[];
}

/** 更新文件摘要的入参 */
export interface FileSummaryUpdate {
  fileId: number;
  fileSummary: string | null;
  status: SummaryStatus;
  model: string | null;
  promptVersion: string | null;
}

/**
 * 写入文件级摘要及其状态元数据（summary_status/model/prompt_ver/updated_at）。
 * summary_updated_at 与 updated_at 均置为当前时间。
 */
export function updateFileSummary(db: DB, update: FileSummaryUpdate): void {
  db.prepare(
    "UPDATE files SET file_summary = @fileSummary, summary_status = @status, " +
      "summary_model = @model, summary_prompt_ver = @promptVersion, " +
      "summary_updated_at = datetime('now'), updated_at = datetime('now') " +
      "WHERE id = @fileId",
  ).run({
    fileId: update.fileId,
    fileSummary: update.fileSummary,
    status: update.status,
    model: update.model,
    promptVersion: update.promptVersion,
  });
}

/** 仅更新文件的摘要状态（用于标记 error，不改写摘要正文） */
export function setFileSummaryStatus(
  db: DB,
  fileId: number,
  status: SummaryStatus,
): void {
  db.prepare(
    "UPDATE files SET summary_status = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(status, fileId);
}

/** 统计各摘要状态的文件数量 */
export function countFilesBySummaryStatus(db: DB): Record<string, number> {
  const rows = db
    .prepare("SELECT summary_status AS status, count(*) AS n FROM files GROUP BY summary_status")
    .all() as Array<{ status: string; n: number }>;
  const result: Record<string, number> = {};
  for (const r of rows) result[r.status] = r.n;
  return result;
}

/** 向量化状态取值 */
export type EmbeddingStatus = "pending" | "done" | "error";

/**
 * 列出待向量化的文件（断点续传）：摘要已完成（summary_status='done'，有可嵌入
 * 的摘要文本）且尚未向量化完成（embedding_status != 'done'）。
 */
export function listFilesToEmbed(db: DB): FileRow[] {
  return db
    .prepare(
      "SELECT * FROM files WHERE summary_status = 'done' " +
        "AND embedding_status != 'done' ORDER BY id",
    )
    .all() as FileRow[];
}

/** 更新文件的向量化状态与模型（done 时写入实际模型名） */
export function setFileEmbeddingStatus(
  db: DB,
  fileId: number,
  status: EmbeddingStatus,
  model: string | null = null,
): void {
  db.prepare(
    "UPDATE files SET embedding_status = ?, embedding_model = ?, " +
      "updated_at = datetime('now') WHERE id = ?",
  ).run(status, model, fileId);
}

/** 统计各向量化状态的文件数量 */
export function countFilesByEmbeddingStatus(db: DB): Record<string, number> {
  const rows = db
    .prepare(
      "SELECT embedding_status AS status, count(*) AS n FROM files GROUP BY embedding_status",
    )
    .all() as Array<{ status: string; n: number }>;
  const result: Record<string, number> = {};
  for (const r of rows) result[r.status] = r.n;
  return result;
}