/**
 * graph/nodes.ts — nodes 表 CRUD（含批量插入）
 *
 * nodes 表记录代码符号（函数 / 类 / 组件 / Hook / 类型 / 变量 / 方法）。
 * M2 写入解析期字段（name/kind/signature/行号/is_exported/source_code），
 * 摘要与向量字段保持默认（pending），由 M3+ 填充。
 *
 * FTS5 同步由 nodes_ai / nodes_au / nodes_ad 触发器自动完成，此处无需手动维护。
 */
import type { DB } from "./db.js";
import type { NodeKind } from "../types/index.js";

/** nodes 表完整行 */
export interface NodeRow {
  id: number;
  file_id: number;
  name: string;
  kind: string;
  signature: string | null;
  start_line: number | null;
  end_line: number | null;
  is_exported: number;
  summary: string | null;
  summary_status: string;
  summary_model: string | null;
  summary_prompt_ver: string | null;
  summary_updated_at: string | null;
  source_code: string | null;
  embedding_status: string;
  embedding_model: string | null;
  created_at: string;
  updated_at: string;
}

/** 插入 nodes 的入参（解析期子集） */
export interface NodeInput {
  fileId: number;
  name: string;
  kind: NodeKind;
  signature?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  isExported?: boolean;
  sourceCode?: string | null;
}

const INSERT_SQL =
  "INSERT INTO nodes(file_id, name, kind, signature, start_line, end_line, is_exported, source_code) " +
  "VALUES (@fileId, @name, @kind, @signature, @startLine, @endLine, @isExported, @sourceCode)";

/** 将 NodeInput 归一化为可绑定的参数对象 */
function toParams(input: NodeInput): Record<string, unknown> {
  return {
    fileId: input.fileId,
    name: input.name,
    kind: input.kind,
    signature: input.signature ?? null,
    startLine: input.startLine ?? null,
    endLine: input.endLine ?? null,
    isExported: input.isExported ? 1 : 0,
    sourceCode: input.sourceCode ?? null,
  };
}

/** 插入单个节点，返回自增 id */
export function insertNode(db: DB, input: NodeInput): number {
  const info = db.prepare(INSERT_SQL).run(toParams(input));
  return Number(info.lastInsertRowid);
}

/**
 * 批量插入节点，返回与输入等长的 id 数组（顺序对应）。
 * 全部包裹在单个事务内，显著提升写入吞吐。
 */
export function insertNodes(db: DB, inputs: readonly NodeInput[]): number[] {
  const stmt = db.prepare(INSERT_SQL);
  const ids: number[] = [];
  const tx = db.transaction((rows: readonly NodeInput[]) => {
    for (const row of rows) {
      const info = stmt.run(toParams(row));
      ids.push(Number(info.lastInsertRowid));
    }
  });
  tx(inputs);
  return ids;
}

/** 按 id 查询节点 */
export function getNodeById(db: DB, id: number): NodeRow | undefined {
  return db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as
    | NodeRow
    | undefined;
}

/** 查询某文件下的全部节点 */
export function getNodesByFile(db: DB, fileId: number): NodeRow[] {
  return db
    .prepare("SELECT * FROM nodes WHERE file_id = ? ORDER BY start_line")
    .all(fileId) as NodeRow[];
}

/** 按名字查询节点（可能多个同名） */
export function getNodesByName(db: DB, name: string): NodeRow[] {
  return db.prepare("SELECT * FROM nodes WHERE name = ?").all(name) as NodeRow[];
}

/**
 * 解析 M1 临时标识 `filePath#name` 为库中已有的 node.id。
 * 供增量 ingest 回退查询跨文件边端点。同名多个节点时取第一个。
 */
export function resolveNodeByTempId(db: DB, tempId: string): number | undefined {
  const sep = tempId.lastIndexOf("#");
  if (sep < 0) return undefined;
  const filePath = tempId.slice(0, sep);
  const name = tempId.slice(sep + 1);
  const row = db
    .prepare(
      "SELECT n.id FROM nodes n JOIN files f ON n.file_id = f.id " +
        "WHERE f.file_path = ? AND n.name = ? LIMIT 1",
    )
    .get(filePath, name) as { id: number } | undefined;
  return row?.id;
}

/** 统计节点总数 */
export function countNodes(db: DB): number {
  return db.prepare("SELECT count(*) FROM nodes").pluck().get() as number;
}

/** 删除某文件下的全部节点（用于增量重建单文件） */
export function deleteNodesByFile(db: DB, fileId: number): void {
  db.prepare("DELETE FROM nodes WHERE file_id = ?").run(fileId);
}

/** 通过 FTS5 全文检索节点名 / 摘要，返回命中的节点行（按 BM25 相关性升序） */
export function searchNodesFts(
  db: DB,
  query: string,
  limit = 20,
): NodeRow[] {
  return db
    .prepare(
      "SELECT n.* FROM nodes_fts f JOIN nodes n ON n.id = f.rowid " +
        "WHERE nodes_fts MATCH ? ORDER BY rank LIMIT ?",
    )
    .all(query, limit) as NodeRow[];
}

/** 更新单个节点摘要的入参 */
export interface NodeSummaryUpdate {
  nodeId: number;
  summary: string | null;
  status: "pending" | "done" | "error";
  model: string | null;
  promptVersion: string | null;
}

/**
 * 批量写入 node 摘要及其状态元数据（单事务）。
 * FTS5 通过 nodes_au 触发器自动同步 name+summary，无需手动维护。
 */
export function updateNodeSummaries(
  db: DB,
  updates: readonly NodeSummaryUpdate[],
): void {
  const stmt = db.prepare(
    "UPDATE nodes SET summary = @summary, summary_status = @status, " +
      "summary_model = @model, summary_prompt_ver = @promptVersion, " +
      "summary_updated_at = datetime('now'), updated_at = datetime('now') " +
      "WHERE id = @nodeId",
  );
  const tx = db.transaction((rows: readonly NodeSummaryUpdate[]) => {
    for (const row of rows) {
      stmt.run({
        nodeId: row.nodeId,
        summary: row.summary,
        status: row.status,
        model: row.model,
        promptVersion: row.promptVersion,
      });
    }
  });
  tx(updates);
}

/** 将某文件下所有节点的摘要状态置为指定值（用于标记 error） */
export function setNodesSummaryStatusByFile(
  db: DB,
  fileId: number,
  status: "pending" | "done" | "error",
): void {
  db.prepare(
    "UPDATE nodes SET summary_status = ?, updated_at = datetime('now') WHERE file_id = ?",
  ).run(status, fileId);
}

/** 向量化状态取值 */
export type NodeEmbeddingStatus = "pending" | "done" | "error";

/**
 * 列出待向量化的节点（断点续传）：摘要已完成（summary_status='done' 且 summary
 * 非空）且尚未向量化完成（embedding_status != 'done'）。
 */
export function listNodesToEmbed(db: DB): NodeRow[] {
  return db
    .prepare(
      "SELECT * FROM nodes WHERE summary_status = 'done' AND summary IS NOT NULL " +
        "AND embedding_status != 'done' ORDER BY id",
    )
    .all() as NodeRow[];
}

/** 更新单个节点的向量化状态与模型 */
export function setNodeEmbeddingStatus(
  db: DB,
  nodeId: number,
  status: NodeEmbeddingStatus,
  model: string | null = null,
): void {
  db.prepare(
    "UPDATE nodes SET embedding_status = ?, embedding_model = ?, " +
      "updated_at = datetime('now') WHERE id = ?",
  ).run(status, model, nodeId);
}

/** 批量更新节点向量化状态（单事务，done 时写模型名） */
export function setNodesEmbeddingStatus(
  db: DB,
  updates: ReadonlyArray<{ nodeId: number; status: NodeEmbeddingStatus; model: string | null }>,
): void {
  const stmt = db.prepare(
    "UPDATE nodes SET embedding_status = ?, embedding_model = ?, " +
      "updated_at = datetime('now') WHERE id = ?",
  );
  const tx = db.transaction(
    (
      rows: ReadonlyArray<{
        nodeId: number;
        status: NodeEmbeddingStatus;
        model: string | null;
      }>,
    ) => {
      for (const r of rows) stmt.run(r.status, r.model, r.nodeId);
    },
  );
  tx(updates);
}

/** 统计各向量化状态的节点数量 */
export function countNodesByEmbeddingStatus(db: DB): Record<string, number> {
  const rows = db
    .prepare(
      "SELECT embedding_status AS status, count(*) AS n FROM nodes GROUP BY embedding_status",
    )
    .all() as Array<{ status: string; n: number }>;
  const result: Record<string, number> = {};
  for (const r of rows) result[r.status] = r.n;
  return result;
}