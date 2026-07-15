/**
 * vector/batch-embedder.ts — 摘要向量化批处理器（断点续传）
 *
 * 职责：
 * - 断点续传：只处理 summary_status='done' 且 embedding_status != 'done' 的
 *   files / nodes；跳过 embedding_status='done'（利用 embedding_status +
 *   embedding_model 状态机）。
 * - 分批：按 config.embedding.batchSize 切分文本，调用 EmbeddingClient.embed。
 * - 落库：向量写入 file_vectors / node_vectors（vec0），并逐条置
 *   embedding_status='done' + embedding_model。
 * - 容错：单批失败则将该批记录标记 embedding_status='error'，不中断整体。
 *
 * 向量化文本：
 * - 文件：优先 file_summary。
 * - 节点：`{name}\n{summary}`（summary 必非空，见 listNodesToEmbed）。
 */
import type { DB } from "../graph/db.js";
import { logger } from "../utils/logger.js";
import {
  listFilesToEmbed,
  setFileEmbeddingStatus,
  type FileRow,
} from "../graph/files.js";
import {
  listNodesToEmbed,
  setNodeEmbeddingStatus,
  type NodeRow,
} from "../graph/nodes.js";
import type { EmbeddingClient } from "./embedding-client.js";
import { upsertVectors, type VectorTable } from "./store.js";

/** 向量化进度事件 */
export interface EmbedProgressEvent {
  scope: "file" | "node";
  total: number;
  done: number;
  failed: number;
}

/** 向量化选项 */
export interface EmbedOptions {
  /** 每批文本数（默认取 client 侧，无则 32） */
  batchSize?: number;
  /** 写入 embedding_model 的模型名（默认取 client.model） */
  model?: string;
  /** 进度回调 */
  onProgress?: (event: EmbedProgressEvent) => void;
}

/** 向量化结果统计 */
export interface EmbedResult {
  files: { total: number; done: number; failed: number };
  nodes: { total: number; done: number; failed: number };
}

/** 待嵌入的一条记录（id + 文本） */
interface EmbedItem {
  id: number;
  text: string;
}

/** 将数组按 size 切片 */
function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/** 文件向量化文本：优先 file_summary，退化到 file_path */
function fileToText(f: FileRow): string {
  return (f.file_summary ?? "").trim() || f.file_path;
}

/** 节点向量化文本：name + summary */
function nodeToText(n: NodeRow): string {
  return `${n.name}\n${(n.summary ?? "").trim()}`.trim();
}

/**
 * 对一组 EmbedItem 分批向量化并落库到指定向量表。
 * 单批失败仅标记该批 error，返回 [done, failed] 计数。
 *
 * 并发安全说明（审查项 #4）：
 * - 本处理器不做批间并发：各 batch 通过 `for...of` 串行处理，一批完成（含落库）
 *   后才处理下一批，不存在多批同时写库。files/nodes 的向量化同样是先 file 后
 *   node 串行进行（见 embedPending）。
 * - 每批落库在单事务内完成：向量 upsert 到 vec0 表 + 逐条置 embedding_status='done'
 *   （或失败时逐条置 'error'），且每条只 UPDATE 自身主键行，无共享可变状态。
 * - 引擎保证：better-sqlite3 同步写，事务内串行完成，天然无并发写竞态。
 * - 未来改动注意：若为提升吞吐引入批间并发（如 Promise.all 多批并行），需确保
 *   各批的 id 集合互不相交（当前 chunk 切分已保证），并复核事务隔离；同一记录
 *   不得被两批同时写。
 */
async function embedItems(
  db: DB,
  client: EmbeddingClient,
  table: VectorTable,
  items: readonly EmbedItem[],
  batchSize: number,
  model: string,
  scope: "file" | "node",
  onProgress?: (event: EmbedProgressEvent) => void,
): Promise<{ done: number; failed: number }> {
  const total = items.length;
  let done = 0;
  let failed = 0;

  for (const batch of chunk(items, batchSize)) {
    try {
      const vectors = await client.embed(batch.map((it) => it.text));
      if (vectors.length !== batch.length) {
        throw new Error(
          `embedding 返回数量(${vectors.length})与请求(${batch.length})不匹配`,
        );
      }
      const entries = batch.map((it, i) => ({
        id: it.id,
        vector: vectors[i] as number[],
      }));
      // 单事务：向量写入 + 状态置 done，保证一致。
      const tx = db.transaction(() => {
        upsertVectors(db, table, entries);
        for (const it of batch) setEmbeddingDone(db, scope, it.id, model);
      });
      tx();
      done += batch.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[${scope}] 批量向量化失败（${batch.length} 条）：${msg}`);
      for (const it of batch) markEmbeddingError(db, scope, it.id);
      failed += batch.length;
    }
    onProgress?.({ scope, total, done, failed });
  }

  return { done, failed };
}

/** 置向量化成功状态 */
function setEmbeddingDone(
  db: DB,
  scope: "file" | "node",
  id: number,
  model: string,
): void {
  if (scope === "file") setFileEmbeddingStatus(db, id, "done", model);
  else setNodeEmbeddingStatus(db, id, "done", model);
}

/** 置向量化失败状态 */
function markEmbeddingError(db: DB, scope: "file" | "node", id: number): void {
  if (scope === "file") setFileEmbeddingStatus(db, id, "error");
  else setNodeEmbeddingStatus(db, id, "error");
}

/**
 * 向量化所有待处理的 files 与 nodes（断点续传）。
 *
 * @param db     已迁移的数据库
 * @param client Embedding 客户端（可注入 mock）
 * @param opts   批大小 / 模型名 / 进度回调
 */
export async function embedPending(
  db: DB,
  client: EmbeddingClient,
  opts: EmbedOptions = {},
): Promise<EmbedResult> {
  const batchSize = Math.max(1, opts.batchSize ?? client.batchSize ?? 32);
  const model = opts.model ?? client.model;

  const fileRows = listFilesToEmbed(db);
  const fileItems: EmbedItem[] = fileRows.map((f) => ({
    id: f.id,
    text: fileToText(f),
  }));
  const fileStats = await embedItems(
    db,
    client,
    "file_vectors",
    fileItems,
    batchSize,
    model,
    "file",
    opts.onProgress,
  );

  const nodeRows = listNodesToEmbed(db);
  const nodeItems: EmbedItem[] = nodeRows.map((n) => ({
    id: n.id,
    text: nodeToText(n),
  }));
  const nodeStats = await embedItems(
    db,
    client,
    "node_vectors",
    nodeItems,
    batchSize,
    model,
    "node",
    opts.onProgress,
  );

  return {
    files: { total: fileItems.length, ...fileStats },
    nodes: { total: nodeItems.length, ...nodeStats },
  };
}