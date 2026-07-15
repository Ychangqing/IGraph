/**
 * incremental/index.ts — 增量更新主编排（M8）
 *
 * 串起 diff-detector → change-classifier → cascade → 摘要 / 向量化 →
 * 多模态边刷新，实现「首次全量、后续增量」：仅对受影响文件重解析、重摘要、
 * 重向量化，避免全量重建。
 *
 * 编排顺序（单次 incrementalUpdate 调用内）：
 *   1) detectChanges：以 files.hash 快照对比工作区，产出 ChangeSet。
 *   2) classifyChanges：翻译为 deletePaths / renames / rebuildPaths。
 *   3) 无变更则短路返回（changed=false）。
 *   4) deleted：逐个 cascadeDeleteFile（清向量 + 级联删 nodes/edges/边）。
 *   5) renamed：逐个 renameFile（仅改路径，内容与向量不动）。
 *   6) rebuild：parseRepository 全量解析 → rebuildFiles 裁剪落库并置 pending。
 *   7) generateSummaries / embedPending：断点续传，只处理 pending。
 *   8) refreshMultimodalEdges：对受影响文件（新增/修改/删除的 fileId）清旧边后
 *      复用已存资源向量重连。
 *
 * 依赖注入：解析器、摘要、向量化的具体调用与 build.ts 对齐；凭据从
 * config.credentials 注入，无 API Key 时优雅降级（仅落库、跳过向量化与建边）。
 */
import { logger } from "../utils/logger.js";
import type { ResolvedConfig } from "../config/index.js";
import type { DB } from "../graph/db.js";
import { getFileByPath } from "../graph/files.js";
import { parseRepository } from "../parser/index.js";
import {
  generateSummaries,
  type GenerateSummariesOptions,
} from "../semantic/index.js";
import { EmbeddingClient, embedPending } from "../vector/index.js";
import { refreshMultimodalEdges } from "../multimodal/index.js";
import { cascadeDeleteFile, renameFile, rebuildFiles } from "./cascade.js";
import { classifyChanges } from "./change-classifier.js";
import { detectChanges, isEmptyChangeSet, type ChangeSet } from "./diff-detector.js";

/** 增量更新可选项 */
export interface IncrementalUpdateOptions {
  /** 工作区根目录（默认 process.cwd()） */
  root?: string;
  /** 跳过 LLM，走启发式摘要且不向量化（无需 API Key） */
  noLlm?: boolean;
}

/** 增量更新结果统计 */
export interface IncrementalUpdateResult {
  /** 是否检测到变更（false 时其余字段均为 0 / 空） */
  changed: boolean;
  /** 变更明细 */
  changes: ChangeSet;
  /** 级联删除的文件数 */
  deleted: number;
  /** 重命名的文件数 */
  renamed: number;
  /** 重建的文件数（added ∪ modified） */
  rebuilt: number;
  /** 重建落库的节点数 */
  nodes: number;
  /** 重建落库的边数 */
  edges: number;
  /** 摘要成功数 */
  summariesDone: number;
  /** 向量化的 file 成功数 */
  filesEmbedded: number;
  /** 向量化的 node 成功数 */
  nodesEmbedded: number;
  /** 多模态边刷新：重连的资源数 */
  resourcesRelinked: number;
  /** 多模态边刷新：新建边数 */
  resourceEdges: number;
  /** 降级 / 提示信息汇总 */
  notes: string[];
}

/**
 * 执行一次增量更新。
 *
 * @param db     已打开并迁移的数据库（首次构建后应有 files 记录）
 * @param config 已解析配置（含 parser include/exclude、credentials、阈值等）
 */
export async function incrementalUpdate(
  db: DB,
  config: ResolvedConfig,
  options: IncrementalUpdateOptions = {},
): Promise<IncrementalUpdateResult> {
  const root = options.root ?? process.cwd();
  const noLlm = options.noLlm === true;
  const { include, exclude } = config.parser;
  const notes: string[] = [];

  // ── 1) 变更检测 ──
  const changes = await detectChanges(db, { root, include, exclude });
  if (isEmptyChangeSet(changes)) {
    logger.info("未检测到文件变更，无需增量更新");
    return emptyResult(changes);
  }
  const plan = classifyChanges(changes);
  logger.info(
    `变更：新增 ${changes.added.length}，修改 ${changes.modified.length}，` +
      `删除 ${changes.deleted.length}，重命名 ${changes.renamed.length}`,
  );

  // 受影响文件路径集合（用于最后解析 fileId 做多模态边刷新）：
  //   删除的文件删边前需其 id，故先在删除前采集；重建的文件在落库后采集。
  const affectedPaths = new Set<string>();

  // ── 4) 删除：采集旧 fileId 后级联删除 ──
  let deleted = 0;
  const deletedFileIds: number[] = [];
  for (const path of plan.deletePaths) {
    const file = getFileByPath(db, path);
    if (file !== undefined) {
      deletedFileIds.push(file.id);
    }
    const res = cascadeDeleteFile(db, path);
    if (res.deleted) {
      deleted += 1;
    }
  }

  // ── 5) 重命名：仅改路径 ──
  let renamed = 0;
  for (const r of plan.renames) {
    if (renameFile(db, r.from, r.to)) {
      renamed += 1;
    }
  }

  // ── 6) 重建（新增 + 修改）──
  let rebuilt = 0;
  let nodes = 0;
  let edges = 0;
  if (plan.rebuildPaths.length > 0) {
    const full = await parseRepository({ root, include, exclude, onlyPaths: plan.rebuildPaths });
    const rebuild = rebuildFiles(db, full, plan.rebuildPaths);
    rebuilt = rebuild.files;
    nodes = rebuild.ingest.nodes;
    edges = rebuild.ingest.edges;
    for (const path of plan.rebuildPaths) {
      affectedPaths.add(path);
    }
  }

  // ── 7) 摘要（断点续传，只处理 pending）──
  const genOptions: GenerateSummariesOptions = noLlm
    ? { mode: "heuristic", maxConcurrency: config.llm.maxConcurrency }
    : {
        mode: "llm",
        maxConcurrency: config.llm.maxConcurrency,
        model: config.llm.model,
        ...(config.llm.fileSummaryModel
          ? { fileSummaryModel: config.llm.fileSummaryModel }
          : {}),
        llm: {
          baseURL: config.llm.baseURL,
          model: config.llm.model,
          apiKey: config.credentials.apiKey,
          temperature: config.llm.temperature,
        },
      };
  const summary = await generateSummaries(db, genOptions);

  // ── 向量化（断点续传）：无凭据则跳过 ──
  let filesEmbedded = 0;
  let nodesEmbedded = 0;
  const hasApiKey = !noLlm && config.credentials.apiKey.trim() !== "";
  if (!hasApiKey) {
    notes.push("未配置 API Key，已跳过向量化与多模态边刷新");
  } else {
    const client = new EmbeddingClient({
      baseURL: config.credentials.embeddingBaseURL ?? config.embedding.baseURL,
      model: config.embedding.model,
      apiKey: config.credentials.apiKey,
      dimensions: config.embedding.dimensions,
      batchSize: config.embedding.batchSize,
    });
    const embed = await embedPending(db, client);
    filesEmbedded = embed.files.done;
    nodesEmbedded = embed.nodes.done;
  }

  // ── 8) 多模态边刷新:采集受影响 fileId(删除的旧 id + 重建后的新 id)──
  let resourcesRelinked = 0;
  let resourceEdges = 0;
  if (hasApiKey) {
    const affectedFileIds = [...deletedFileIds];
    for (const path of affectedPaths) {
      const file = getFileByPath(db, path);
      if (file !== undefined) {
        affectedFileIds.push(file.id);
      }
    }
    const refresh = refreshMultimodalEdges(db, config, affectedFileIds);
    resourcesRelinked = refresh.refreshed;
    resourceEdges = refresh.edges;
    if (refresh.note) {
      notes.push(refresh.note);
    }
  }

  return {
    changed: true,
    changes,
    deleted,
    renamed,
    rebuilt,
    nodes,
    edges,
    summariesDone: summary.done,
    filesEmbedded,
    nodesEmbedded,
    resourcesRelinked,
    resourceEdges,
    notes,
  };
}

/** 无变更时的空结果 */
function emptyResult(changes: ChangeSet): IncrementalUpdateResult {
  return {
    changed: false,
    changes,
    deleted: 0,
    renamed: 0,
    rebuilt: 0,
    nodes: 0,
    edges: 0,
    summariesDone: 0,
    filesEmbedded: 0,
    nodesEmbedded: 0,
    resourcesRelinked: 0,
    resourceEdges: 0,
    notes: [],
  };
}