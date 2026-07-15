/**
 * config/defaults.ts — 默认项目配置
 *
 * 对应规划 4.1 `.igraph/config.json`。`igraph init` 生成的配置以此为模板。
 * 注意：此处不含任何密钥，凭据一律经环境变量注入。
 */
import type { IGraphConfig } from "./schema.js";

export const DEFAULT_CONFIG: IGraphConfig = {
  embedding: {
    baseURL: "http://localhost:8080/v1",
    model: "bge-m3",
    dimensions: 1024,
    batchSize: 32,
  },
  llm: {
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    fileSummaryModel: "gpt-4o",
    temperature: 0,
    maxConcurrency: 5,
    promptVersion: "v1.0",
  },
  parser: {
    languages: ["typescript", "javascript"],
    include: ["**/*"],
    exclude: [
      "node_modules/**",
      "dist/**",
      "**/*.test.*",
      "**/*.spec.*",
      "**/*.d.ts",
    ],
  },
  retrieval: {
    fileTopK: 10,
    nodeTopK: 10,
    fallbackThreshold: 0.75,
    graphHops: 2,
    fusion: "rrf",
    rrfK: 60,
    denseWeight: 1.0,
    ftsWeight: 1.0,
    resourceTopK: 3,
  },
  multimodal: {
    strongLinkThreshold: 0.85,
    weakLinkThreshold: 0.7,
    llmConfirmWeakLinks: false,
  },
};