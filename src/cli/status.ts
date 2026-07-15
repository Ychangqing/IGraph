/**
 * cli/status.ts — `igraph status` 命令（M9-A）
 *
 * 汇总展示当前工作目录图谱的状态快照：schema 版本、文件/节点/边数量、
 * 三类向量数（file/node/resource）、多模态资源与资源边数量，以及
 * 摘要 / 向量化进度（pending/done/error 分布）。
 *
 * 该命令为只读操作，不修改数据库。若尚未构建（数据库文件不存在或无文件记录），
 * 给出中文友好提示并优雅退出，不视为错误。所有计数复用图谱数据层现成接口，
 * 不重复实现统计逻辑。
 */
import { existsSync } from "node:fs";
import { Command } from "commander";
import { logger } from "../utils/logger.js";
import {
  openDatabase,
  closeDatabase,
  getDatabasePath,
  getSchemaVersion,
  countFiles,
  countFilesBySummaryStatus,
  countFilesByEmbeddingStatus,
  countNodes,
  countNodesByEmbeddingStatus,
  countEdges,
  countResources,
  countResourceEdges,
} from "../graph/index.js";
import { countVectors } from "../vector/index.js";

/** 将状态分布 Record 渲染为 `done=x，pending=y，error=z` 的稳定顺序文本 */
function formatStatusDist(dist: Record<string, number>): string {
  const done = dist.done ?? 0;
  const pending = dist.pending ?? 0;
  const error = dist.error ?? 0;
  return `done=${done}，pending=${pending}，error=${error}`;
}

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("查看图谱状态：规模统计、向量与多模态资源、摘要/向量化进度")
    .action(() => {
      const cwd = process.cwd();
      const dbPath = getDatabasePath(cwd);

      // 数据库文件不存在 → 尚未构建，友好提示并优雅退出。
      if (!existsSync(dbPath)) {
        logger.info("尚未构建图谱，请先运行 `igraph build`。");
        return;
      }

      const db = openDatabase(cwd);
      try {
        const fileCount = countFiles(db);
        // 数据库存在但无文件记录：同样视为未构建。
        if (fileCount === 0) {
          logger.info("图谱为空（无文件记录），请先运行 `igraph build`。");
          return;
        }

        const schemaVersion = getSchemaVersion(db);
        const nodeCount = countNodes(db);
        const edgeCount = countEdges(db);

        const fileVectors = countVectors(db, "file_vectors");
        const nodeVectors = countVectors(db, "node_vectors");
        const resourceVectors = countVectors(db, "resource_vectors");

        const prdCount = countResources(db, "prd");
        const dbResCount = countResources(db, "db");
        const resourceTotal = countResources(db);
        const resourceEdgeCount = countResourceEdges(db);

        const fileSummaryDist = countFilesBySummaryStatus(db);
        const fileEmbedDist = countFilesByEmbeddingStatus(db);
        const nodeEmbedDist = countNodesByEmbeddingStatus(db);

        logger.info("── IGraph 图谱状态 ──");
        logger.info(`数据库：${dbPath}`);
        logger.info(`schema 版本：${schemaVersion}`);

        logger.info("── 图谱规模 ──");
        logger.info(`files：${fileCount}`);
        logger.info(`nodes：${nodeCount}`);
        logger.info(`edges：${edgeCount}`);

        logger.info("── 向量 ──");
        logger.info(`file 向量：${fileVectors}`);
        logger.info(`node 向量：${nodeVectors}`);
        logger.info(`resource 向量：${resourceVectors}`);

        logger.info("── 多模态资源 ──");
        logger.info(
          `resources：${resourceTotal}（prd=${prdCount}，db=${dbResCount}）`,
        );
        logger.info(`resource_edges：${resourceEdgeCount}`);

        logger.info("── 进度 ──");
        logger.info(`files 摘要：${formatStatusDist(fileSummaryDist)}`);
        logger.info(`files 向量化：${formatStatusDist(fileEmbedDist)}`);
        logger.info(`nodes 向量化：${formatStatusDist(nodeEmbedDist)}`);
      } finally {
        closeDatabase(db);
      }
    });
}