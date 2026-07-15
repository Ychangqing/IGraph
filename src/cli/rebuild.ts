/**
 * cli/rebuild.ts — `igraph rebuild` 命令（M9-A）
 *
 * 清空现有图谱数据库并从零执行一次全量构建（解析 → 落库 → 摘要 → 向量化）。
 * 与 `build`（首次全量 / 后续自动增量）不同，rebuild 显式丢弃旧快照，用于
 * schema 升级、解析器行为变更或图谱疑似损坏时的“推倒重来”。
 *
 * 清空策略：直接删除 `.igraph/igraph.db` 数据库文件（含 WAL 的 `-wal`/`-shm`
 * 附带文件），随后由 `openDatabase` 自动重建空库并执行迁移。相比手写 DELETE，
 * 该方式可避免遗漏向量虚拟表（vec0）、FTS5、触发器与自增序列，保证干净重建。
 *
 * `--no-llm` 走启发式降级摘要并跳过向量化（无需 API Key）；否则从环境变量
 * IGRAPH_API_KEY 注入凭据。`--dry-run` 仅解析并打印统计，不删库、不写库。
 * 全量构建逻辑复用 build.ts 的 `runFullBuild`，不重复实现。
 */
import { existsSync, rmSync } from "node:fs";
import { Command } from "commander";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../config/index.js";
import { getDatabasePath } from "../graph/index.js";
import { runFullBuild } from "./build.js";

/** 删除数据库主文件及其 WAL 附带文件（-wal / -shm）；不存在则静默跳过 */
function removeDatabaseFiles(dbPath: string): boolean {
  let removed = false;
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${dbPath}${suffix}`;
    if (existsSync(p)) {
      rmSync(p);
      removed = true;
    }
  }
  return removed;
}

export function registerRebuild(program: Command): void {
  program
    .command("rebuild")
    .description("清空现有图谱并从零全量重建（解析 → 落库 → 摘要 → 向量化）")
    .option("--full", "全量重建（默认行为，用于明确表达意图）")
    .option("--dry-run", "仅解析并打印统计，不删库、不写入数据库")
    .option("--no-llm", "跳过 LLM，使用启发式降级摘要（无需 API Key）")
    .action(
      async (opts: { full?: boolean; dryRun?: boolean; llm?: boolean }) => {
        // commander 对 --no-llm 生成 opts.llm，默认 true，加 --no-llm 时为 false
        const noLlm = opts.llm === false;
        const cwd = process.cwd();
        // 解析阶段无需凭据；LLM 摘要模式需要凭据（--no-llm 时不需要）
        const config = loadConfig(cwd, !noLlm);
        const dbPath = getDatabasePath(cwd);

        if (opts.dryRun) {
          // dry-run 不触碰数据库，仅解析统计。
          logger.info("── IGraph 重建（dry-run，不删库不写库）──");
          await runFullBuild(cwd, config, { noLlm, dryRun: true });
          return;
        }

        logger.info("── IGraph 全量重建 ──");
        const removed = removeDatabaseFiles(dbPath);
        if (removed) {
          logger.warn(`已清空旧图谱数据库：${dbPath}`);
        } else {
          logger.info("未发现现有数据库，将直接构建新图谱。");
        }

        // 空库将由 openDatabase 自动创建并迁移，随后执行全量构建。
        await runFullBuild(cwd, config, { noLlm, dryRun: false });
        logger.info("── 重建完成 ──");
      },
    );
}