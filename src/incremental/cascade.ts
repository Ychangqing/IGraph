/**
 * incremental/cascade.ts — 变更文件的级联清理与单文件重落库
 *
 * 提供三类原子操作，供 index.ts 主流程按变更类型编排：
 *
 *  1) cascadeDeleteFile：删除某文件时，先手动清除其 vec0 向量（node_vectors /
 *     file_vectors 无外键联动，不会随 files 删除自动清理），再 deleteFile。
 *     deleteFile 经 SQLite 外键 ON DELETE CASCADE 连带删除该文件的 nodes /
 *     edges / resource_edges（见 schema.ts）。
 *
 *  2) renameFile：内容未变的重命名，仅改写 files.file_path。其 nodes / edges /
 *     向量 / resource_edges 均以 file_id 关联，路径变更不影响，省去重解析与
 *     重向量化。
 *
 *  3) rebuildFiles：对「新增 + 修改」的文件重建。先清除旧节点向量与旧节点
 *     （deleteNodesByFile；新增文件无旧节点，幂等），再从「全量 ParseResult」
 *     裁剪出这些文件的 files/nodes/edges 子集落库，最后把这些文件的摘要 /
 *     向量化状态重置为 pending，交由 generateSummaries / embedPending 断点续传。
 *
 * 关于跨文件边：parseRepository 产出的 edge 以临时标识 `filePath#name`
 * 表示两端。裁剪落库时保留「至少一端节点落在本次重建文件集合」内的边；
 * 另一端指向未变更文件的跨文件边由 ingestParseResult 通过 DB 回退查询
 * 解析（查 nodes JOIN files 匹配 `filePath#name`），若仍无法解析则计入
 * edgesUnresolved 跳过。
 */
import type { DB } from "../graph/db.js";
import type { ParseResult, ScannedFile, CodeNode, CodeEdge } from "../types/index.js";
import { getFileByPath, deleteFile, updateFilePath, setFileSummaryStatus, setFileEmbeddingStatus } from "../graph/files.js";
import { getNodesByFile, deleteNodesByFile, updateNodeSummaries, type NodeRow, type NodeSummaryUpdate } from "../graph/nodes.js";
import { ingestParseResult, type IngestResult } from "../graph/ingest.js";
import { deleteVector } from "../vector/store.js";

/** 级联删除统计 */
export interface CascadeDeleteResult {
  /** 是否命中并删除了文件（路径不存在时 false） */
  deleted: boolean;
  /** 清除的 node 向量数 */
  nodeVectors: number;
  /** 清除的 file 向量数（0 或 1） */
  fileVectors: number;
}

/**
 * 级联删除单个文件及其全部衍生数据。
 *
 * 顺序：先删向量（vec0 无外键，须手动），再 deleteFile（外键级联 nodes/edges/
 * resource_edges）。全过程包裹单事务，任一步失败整体回滚。
 */
export function cascadeDeleteFile(db: DB, filePath: string): CascadeDeleteResult {
  const file = getFileByPath(db, filePath);
  if (file === undefined) {
    return { deleted: false, nodeVectors: 0, fileVectors: 0 };
  }
  const nodes = getNodesByFile(db, file.id);
  const tx = db.transaction((): CascadeDeleteResult => {
    for (const n of nodes) deleteVector(db, "node_vectors", n.id);
    deleteVector(db, "file_vectors", file.id);
    deleteFile(db, file.id);
    return { deleted: true, nodeVectors: nodes.length, fileVectors: 1 };
  });
  return tx();
}

/**
 * 重命名文件（内容不变）：仅改写 file_path。
 * @returns 是否命中旧路径并更新
 */
export function renameFile(db: DB, from: string, to: string): boolean {
  return updateFilePath(db, from, to);
}

/** 单文件重建统计 */
export interface RebuildResult {
  /** 参与重建的文件数 */
  files: number;
  /** 清除的旧 node 向量数 */
  clearedNodeVectors: number;
  /** 落库统计 */
  ingest: IngestResult;
}

/** 旧节点摘要快照（用于 50% 阈值判定） */
interface OldNodeSnapshot {
  summary: string | null;
  summaryStatus: string;
  summaryModel: string | null;
  summaryPromptVer: string | null;
  sourceCode: string | null;
}

/** 变化率阈值：超过此比例的节点源码变化时，整个文件重生成摘要 */
const SUMMARY_REGEN_THRESHOLD = 0.5;

/**
 * 重建「新增 + 修改」文件：清旧节点向量 + 旧节点，再裁剪全量解析结果落库。
 *
 * 50% 阈值优化：对 modified 文件，如果超过 50% 的节点源码未变，则保留旧
 * file_summary 且只对源码变化的节点重生成摘要，节省 LLM 调用。
 *
 * @param db          已迁移的数据库
 * @param full        parseRepository 的全量结果（含所有文件的 files/nodes/edges）
 * @param targetPaths 需要重建的文件相对路径集合（added ∪ modified）
 */
export function rebuildFiles(
  db: DB,
  full: ParseResult,
  targetPaths: readonly string[],
): RebuildResult {
  const targetSet = new Set(targetPaths);
  if (targetSet.size === 0) {
    return {
      files: 0,
      clearedNodeVectors: 0,
      ingest: { files: 0, nodes: 0, edges: 0, edgesSkipped: 0, edgesUnresolved: 0 },
    };
  }

  // ── 0) 缓存旧节点快照（50% 阈值判定需要） ──
  const oldSnapshots = new Map<string, Map<string, OldNodeSnapshot>>();
  for (const path of targetSet) {
    const file = getFileByPath(db, path);
    if (file === undefined) continue;
    const nodes = getNodesByFile(db, file.id);
    const snap = new Map<string, OldNodeSnapshot>();
    for (const n of nodes) {
      snap.set(n.name, {
        summary: n.summary,
        summaryStatus: n.summary_status,
        summaryModel: n.summary_model,
        summaryPromptVer: n.summary_prompt_ver,
        sourceCode: n.source_code,
      });
    }
    oldSnapshots.set(path, snap);
  }

  // ── 1) 清除旧节点向量（modified 文件的旧节点即将删除；新增文件无旧节点）──
  let clearedNodeVectors = 0;
  for (const path of targetSet) {
    const file = getFileByPath(db, path);
    if (file === undefined) continue;
    const oldNodes = getNodesByFile(db, file.id);
    for (const n of oldNodes) {
      deleteVector(db, "node_vectors", n.id);
      clearedNodeVectors += 1;
    }
    deleteVector(db, "file_vectors", file.id);
  }

  // ── 2) 裁剪全量 ParseResult 到目标文件子集 ──
  const subset = sliceParseResult(full, targetSet);

  // ── 3) 落库 + 50% 阈值摘要保留 ──
  const tx = db.transaction((): IngestResult => {
    for (const path of targetSet) {
      const file = getFileByPath(db, path);
      if (file !== undefined) {
        deleteNodesByFile(db, file.id);
      }
    }
    const ingested = ingestParseResult(db, subset);

    for (const path of targetSet) {
      const file = getFileByPath(db, path);
      if (file === undefined) continue;

      const oldSnap = oldSnapshots.get(path);
      if (oldSnap === undefined || oldSnap.size === 0) {
        // 新增文件：全部标 pending
        setFileSummaryStatus(db, file.id, "pending");
        setFileEmbeddingStatus(db, file.id, "pending");
        continue;
      }

      const newNodes = getNodesByFile(db, file.id);
      if (newNodes.length === 0) {
        setFileSummaryStatus(db, file.id, "pending");
        setFileEmbeddingStatus(db, file.id, "pending");
        continue;
      }

      // 比较新旧节点源码变化率
      const unchanged: Array<{ node: NodeRow; snap: OldNodeSnapshot }> = [];
      const changed: NodeRow[] = [];
      for (const n of newNodes) {
        const old = oldSnap.get(n.name);
        if (old !== undefined && old.sourceCode === n.source_code) {
          unchanged.push({ node: n, snap: old });
        } else {
          changed.push(n);
        }
      }

      const unchangedRatio = unchanged.length / newNodes.length;
      if (unchangedRatio >= SUMMARY_REGEN_THRESHOLD) {
        // 变化不大：保留 file_summary，只对变化的节点标 pending
        // 回写未变节点的旧摘要（deleteNodesByFile 已清除）
        const restores: NodeSummaryUpdate[] = unchanged
          .filter((u) => u.snap.summaryStatus === "done" && u.snap.summary !== null)
          .map((u) => ({
            nodeId: u.node.id,
            summary: u.snap.summary,
            status: "done" as const,
            model: u.snap.summaryModel,
            promptVersion: u.snap.summaryPromptVer,
          }));
        if (restores.length > 0) {
          updateNodeSummaries(db, restores);
        }
        // 变化的节点保持 pending（ingest 后默认状态）
        // file 级：保留旧摘要状态
        setFileEmbeddingStatus(db, file.id, "pending");
      } else {
        // 变化过大：全部标 pending
        setFileSummaryStatus(db, file.id, "pending");
        setFileEmbeddingStatus(db, file.id, "pending");
      }
    }
    return ingested;
  });
  const ingest = tx();

  return { files: targetSet.size, clearedNodeVectors, ingest };
}

/**
 * 从全量 ParseResult 裁剪出目标文件的 files/nodes/edges 子集。
 *
 * - files / nodes：filePath ∈ targetSet 的项。
 * - edges：至少一端节点属于本次子集即保留；另一端指向库中已有节点的边
 *   由 ingestParseResult 通过 DB 回退查询解析。
 */
function sliceParseResult(full: ParseResult, targetSet: Set<string>): ParseResult {
  const files: ScannedFile[] = full.files.filter((f) => targetSet.has(f.filePath));
  const nodes: CodeNode[] = full.nodes.filter((n) => targetSet.has(n.filePath));

  const nodeIds = new Set<string>();
  for (const n of nodes) nodeIds.add(n.id);

  const edges: CodeEdge[] = full.edges.filter(
    (e) => nodeIds.has(e.source) || nodeIds.has(e.target),
  );

  return { files, nodes, edges };
}