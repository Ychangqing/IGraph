/**
 * cli/query.ts — `igraph query` 命令（M4/M5）
 *
 * 流程：向量化 query → 两级检索 + 双通道 RRF 融合（+ fallback）→ 图谱展开
 *   → 结构化 / 文本输出。凭据从环境变量 IGRAPH_API_KEY 注入。
 *
 * 优雅降级（对齐 eval 命令）：当数据库无 node 向量（--no-llm 构建）或未配置
 *   IGRAPH_API_KEY 时，query 无法走 Dense 通道，自动降级为「仅 FTS5 通道」
 *   检索（searchFtsOnly，仍走 RRF 融合），免密钥加载配置、不创建 EmbeddingClient，
 *   保证离线可查询、不因缺失 API Key 报错退出，并向用户输出降级提示（note）。
 */
import { Command } from "commander";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../config/index.js";
import { openDatabase, closeDatabase } from "../graph/index.js";
import { EmbeddingClient } from "../vector/index.js";
import { countVectors } from "../vector/store.js";
import {
  search,
  searchFtsOnly,
  type SearchResponse,
  expandGraph,
  formatResult,
  renderText,
  renderJson,
} from "../retrieval/index.js";

export function registerQuery(program: Command): void {
  program
    .command("query")
    .description("查询代码知识图谱（两级检索 + RRF 融合 + 图谱展开）")
    .argument("<question>", "自然语言查询")
    .option("--top-k <n>", "返回结果数", (v) => Number.parseInt(v, 10))
    .option("--json", "以 JSON 结构输出")
    .action(
      async (
        question: string,
        opts: { topK?: number; json?: boolean },
      ) => {
        const cwd = process.cwd();
        // 检索支持降级，不强制要求 API Key（对齐 eval 命令）。
        const config = loadConfig(cwd, false);

        const db = openDatabase(cwd);
        try {
          const limit =
            opts.topK && opts.topK > 0 ? opts.topK : config.retrieval.nodeTopK;

          // ── 降级探测：数据库是否有 node 向量 + 是否有 API Key ──
          const hasVectors = countVectors(db, "node_vectors") > 0;
          const hasApiKey = config.credentials.apiKey.trim() !== "";
          const canDense = hasVectors && hasApiKey;

          let response: SearchResponse;
          let note: string | undefined;

          if (canDense) {
            // 完整 dense+fts5 双通道检索路径（需 API Key）。
            const client = new EmbeddingClient({
              baseURL:
                config.credentials.embeddingBaseURL ?? config.embedding.baseURL,
              model: config.embedding.model,
              apiKey: config.credentials.apiKey,
              dimensions: config.embedding.dimensions,
              batchSize: config.embedding.batchSize,
            });
            response = await search(db, client, question, {
              retrieval: config.retrieval,
              limit,
            });
          } else {
            // 降级：仅 FTS5 通道检索（仍走 RRF，dense 通道为空），免密钥、不创建 EmbeddingClient。
            const reason = !hasVectors
              ? "数据库无 node 向量（可能以 --no-llm 构建）"
              : "未配置 IGRAPH_API_KEY，无法向量化 query";
            note = `无 Embedding 服务，已降级为仅 FTS5 通道检索（RRF 融合，dense 通道为空）；原因：${reason}`;
            response = searchFtsOnly(db, question, {
              retrieval: config.retrieval,
              limit,
            });
          }

          const seedIds = response.results.map((r) => r.nodeId);
          const neighbors = expandGraph(db, seedIds, {
            maxHops: config.retrieval.graphHops,
            direction: "both",
          });

          const formatted = formatResult(db, question, response, neighbors);

          if (opts.json) {
            process.stdout.write(renderJson(formatted) + "\n");
          } else {
            logger.info(renderText(formatted));
          }
          if (note) logger.warn(note);
        } finally {
          closeDatabase(db);
        }
      },
    );
}