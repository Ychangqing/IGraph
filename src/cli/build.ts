/**
 * cli/build.ts — `igraph build` 命令
 *
 * `--dry-run`：运行 5-Pass 解析流水线并打印 files/nodes/edges 统计，不写数据库。
 * 默认（非 dry-run）：解析后落库到 `.igraph/igraph.db`（M2），随后生成
 *   语义摘要（M3）。`--no-llm` 走启发式降级（无需 API Key）；否则调用 LLM
 *   （凭据从环境变量 IGRAPH_API_KEY 注入）。
 */
import { Command } from "commander";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../config/index.js";
import { parseRepository } from "../parser/index.js";
import type { EdgeKind, NodeKind } from "../types/index.js";
import {
  openDatabase,
  closeDatabase,
  ingestParseResult,
  getDatabasePath,
  countFiles,
  countFilesBySummaryStatus,
} from "../graph/index.js";
import {
  generateSummaries,
  type GenerateSummariesOptions,
  type ProgressEvent,
} from "../semantic/index.js";
import {
  EmbeddingClient,
  embedPending,
  type EmbedProgressEvent,
} from "../vector/index.js";
import { incrementalUpdate } from "../incremental/index.js";
import type { ResolvedConfig } from "../config/index.js";

/**
 * 执行一次全量构建（解析 → 落库 → 摘要 → 向量化），落地到 `.igraph/igraph.db`。
 *
 * 从 build 命令 action 中提取，供 `build`（首次全量）与 `rebuild --full`（清空后重建）
 * 共用，避免逻辑复制。行为与原 action 全量路径保持一致：
 * - `noLlm=true` 走启发式降级摘要且跳过向量化；
 * - `dryRun=true` 仅解析并打印统计，不写库；
 * - 打印进度沿用现有 logger 风格。
 *
 * @param cwd 工作目录
 * @param config 已加载配置（调用方负责按 noLlm 决定是否 requireApiKey）
 * @param opts.noLlm 跳过 LLM，启发式降级并跳过向量化
 * @param opts.dryRun 仅解析并打印统计，不写库
 */
export async function runFullBuild(
  cwd: string,
  config: ResolvedConfig,
  opts: { noLlm?: boolean; dryRun?: boolean } = {},
): Promise<void> {
  const noLlm = opts.noLlm === true;
  const dryRun = opts.dryRun === true;
  const { include, exclude } = config.parser;

  const result = await parseRepository({ root: cwd, include, exclude });

  // 统计各类节点 / 边
  const nodeByKind = new Map<NodeKind, number>();
  for (const n of result.nodes) {
    nodeByKind.set(n.kind, (nodeByKind.get(n.kind) ?? 0) + 1);
  }
  const edgeByKind = new Map<EdgeKind, number>();
  for (const e of result.edges) {
    edgeByKind.set(e.kind, (edgeByKind.get(e.kind) ?? 0) + 1);
  }

  const title = dryRun
    ? "── IGraph 解析结果（dry-run）──"
    : "── IGraph 解析结果 ──";
  logger.info(title);
  logger.info(`files: ${result.files.length}`);
  logger.info(`nodes: ${result.nodes.length}`);
  for (const [kind, count] of nodeByKind) {
    logger.info(`  - ${kind}: ${count}`);
  }
  logger.info(`edges: ${result.edges.length}`);
  for (const [kind, count] of edgeByKind) {
    logger.info(`  - ${kind}: ${count}`);
  }

  if (dryRun) return;

  // ── 落库 ──
  const db = openDatabase(cwd);
  try {
    const ingested = ingestParseResult(db, result);
    logger.info("── 落库完成 ──");
    logger.info(`files: ${ingested.files}`);
    logger.info(`nodes: ${ingested.nodes}`);
    logger.info(
      `edges: ${ingested.edges}（去重跳过 ${ingested.edgesSkipped}，` +
        `未解析跳过 ${ingested.edgesUnresolved}）`,
    );
    logger.info(`数据库：${getDatabasePath(cwd)}`);

    // ── 语义摘要（M3）──
    logger.info(
      noLlm ? "── 生成摘要（启发式降级模式）──" : "── 生成摘要（LLM 模式）──",
    );
    const onProgress = (e: ProgressEvent): void => {
      const flag = e.status === "done" ? "✓" : "✗";
      logger.info(`  [${e.done + e.failed}/${e.total}] ${flag} ${e.filePath}`);
    };
    const genOptions: GenerateSummariesOptions = noLlm
      ? {
          mode: "heuristic",
          maxConcurrency: config.llm.maxConcurrency,
          onProgress,
        }
      : {
          mode: "llm",
          maxConcurrency: config.llm.maxConcurrency,
          onProgress,
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
    logger.info("── 摘要完成 ──");
    logger.info(
      `处理 ${summary.total} 个文件：成功 ${summary.done}，失败 ${summary.failed}` +
        (summary.interrupted ? "（已中断）" : ""),
    );
    const counts = countFilesBySummaryStatus(db);
    logger.info(
      `files 摘要状态：done=${counts.done ?? 0}，pending=${counts.pending ?? 0}，error=${counts.error ?? 0}`,
    );

    // ── 向量化（M4）──
    // 无凭据（--no-llm 或未配置 API Key）时跳过，query 时再提示。
    if (noLlm || config.credentials.apiKey.trim() === "") {
      logger.info(
        "── 跳过向量化 ──（未提供 API Key；配置 IGRAPH_API_KEY 后重新构建以启用向量检索）",
      );
    } else {
      logger.info("── 向量化（Embedding）──");
      const client = new EmbeddingClient({
        baseURL: config.credentials.embeddingBaseURL ?? config.embedding.baseURL,
        model: config.embedding.model,
        apiKey: config.credentials.apiKey,
        dimensions: config.embedding.dimensions,
        batchSize: config.embedding.batchSize,
      });
      const onEmbedProgress = (e: EmbedProgressEvent): void => {
        logger.info(`  [${e.scope}] [${e.done + e.failed}/${e.total}]`);
      };
      const embed = await embedPending(db, client, {
        onProgress: onEmbedProgress,
      });
      logger.info("── 向量化完成 ──");
      logger.info(
        `files：成功 ${embed.files.done}，失败 ${embed.files.failed}（共 ${embed.files.total}）`,
      );
      logger.info(
        `nodes：成功 ${embed.nodes.done}，失败 ${embed.nodes.failed}（共 ${embed.nodes.total}）`,
      );
    }
  } finally {
    closeDatabase(db);
  }
}

export function registerBuild(program: Command): void {
  program
    .command("build")
    .description("构建代码知识图谱")
    .option("--incremental", "增量构建")
    .option("--dry-run", "仅解析并打印统计，不写入数据库")
    .option("--no-llm", "跳过 LLM，使用启发式降级摘要（无需 API Key）")
    .action(
      async (opts: {
        incremental?: boolean;
        dryRun?: boolean;
        llm?: boolean;
      }) => {
        // commander 对 --no-llm 生成 opts.llm，默认 true，加 --no-llm 时为 false
        const noLlm = opts.llm === false;
        const cwd = process.cwd();
        // 解析阶段无需凭据；LLM 摘要模式需要凭据（--no-llm 时不需要）
        const config = loadConfig(cwd, !noLlm);

        // ── 增量构建分支 ──
        // 显式 --incremental，或数据库已存在文件记录（首次构建后自动增量）时，
        // 走 diff 级联更新，仅处理受影响文件。dry-run 不适用增量。
        if (!opts.dryRun) {
          const probe = openDatabase(cwd);
          let hasSnapshot = false;
          try {
            hasSnapshot = countFiles(probe) > 0;
          } finally {
            closeDatabase(probe);
          }
          if (opts.incremental || hasSnapshot) {
            const db = openDatabase(cwd);
            try {
              logger.info("── IGraph 增量更新 ──");
              const r = await incrementalUpdate(db, config, { root: cwd, noLlm });
              if (!r.changed) {
                logger.info("无变更，图谱保持最新");
                return;
              }
              logger.info("── 增量更新完成 ──");
              logger.info(
                `删除 ${r.deleted}，重命名 ${r.renamed}，重建 ${r.rebuilt}` +
                  `（新增节点 ${r.nodes}，新增边 ${r.edges}）`,
              );
              logger.info(
                `摘要成功 ${r.summariesDone}；向量化 files ${r.filesEmbedded}、nodes ${r.nodesEmbedded}`,
              );
              logger.info(
                `多模态边刷新：重连资源 ${r.resourcesRelinked}，新建边 ${r.resourceEdges}`,
              );
              for (const note of r.notes) {
                logger.info(`  提示：${note}`);
              }
              logger.info(`数据库：${getDatabasePath(cwd)}`);
            } finally {
              closeDatabase(db);
            }
            return;
          }
        }

        // ── 全量构建分支 ──
        // 无快照（首次构建）或 dry-run：走完整解析 → 落库 → 摘要 → 向量化。
        await runFullBuild(cwd, config, { noLlm, dryRun: opts.dryRun });
      },
    );
}
