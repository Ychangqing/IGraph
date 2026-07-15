/**
 * cli/eval.ts — `igraph eval` 命令（M5）
 *
 * 评测检索质量（Recall@K / MRR / 平均查询耗时）：
 *   读取评测数据集 → 复用 M4 检索链（Dense+FTS5 RRF）逐条检索
 *   → 计算指标 → 终端表格报告。
 *
 * 优雅降级：无 API Key 或数据库无 node 向量（--no-llm 构建）时，
 *   自动降级为仅 FTS5 通道检索（仍走 RRF），评测照常跑通，报告标注降级原因。
 *   因此加载配置时 requireApiKey 传 false（评测不强依赖凭据）。
 */
import { join } from "node:path";
import { Command } from "commander";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../config/index.js";
import { openDatabase, closeDatabase } from "../graph/index.js";
import { loadEvalCases, runEvalAndRender } from "../eval/index.js";

/** 数据集默认路径（相对项目根） */
const DEFAULT_TEST_SET = join("tests", "fixtures", "eval", "queries.json");

export function registerEval(program: Command): void {
  program
    .command("eval")
    .description("评测检索质量（Recall@K / MRR / 平均查询耗时）")
    .option("--test-set <path>", "评测数据集路径（queries.json）", DEFAULT_TEST_SET)
    .option("--top-k <n>", "Recall@K 的 K（默认取配置 nodeTopK）", (v) =>
      Number.parseInt(v, 10),
    )
    .action(async (opts: { testSet: string; topK?: number }) => {
      const cwd = process.cwd();
      // 评测支持降级，不强制要求 API Key。
      const config = loadConfig(cwd, false);

      const datasetPath = join(cwd, opts.testSet);
      const cases = loadEvalCases(datasetPath);
      if (cases.length === 0) {
        logger.warn(`评测数据集为空：${datasetPath}`);
        return;
      }

      const db = openDatabase(cwd);
      try {
        const runOpts =
          opts.topK && opts.topK > 0
            ? { db, config, cases, k: opts.topK }
            : { db, config, cases };
        const { result, text } = await runEvalAndRender(runOpts, {
          datasetPath: opts.testSet,
        });
        logger.info(text);
        if (result.note) logger.warn(result.note);
      } finally {
        closeDatabase(db);
      }
    });
}