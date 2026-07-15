/**
 * config/index.ts — 配置加载、合并与凭据注入
 *
 * 职责：
 * 1. 定位并读取项目配置文件 `.igraph/config.json`。
 * 2. 读取全局配置文件 `~/.igraph/config.json`（含凭据）。
 * 3. 按优先级合并：DEFAULT_CONFIG → 全局配置 → 项目配置。
 * 4. 从环境变量注入 Credentials（最高优先级）。
 * 5. 产出供各模块运行时使用的 ResolvedConfig。
 *
 * 凭据优先级：环境变量 > 全局配置 credentials > 项目配置（项目配置禁止凭据字段）。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "./defaults.js";
import {
  ConfigValidationError,
  validateConfig,
  type IGraphConfig,
  type Credentials,
  type ResolvedConfig,
} from"./schema.js";
import { readGlobalConfig } from "./global.js";

export * from "./schema.js";
export { DEFAULT_CONFIG } from "./defaults.js";
export { readGlobalConfig, writeGlobalConfig, setGlobalConfigValue, getGlobalConfigValue, GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH } from "./global.js";
export type { GlobalConfig } from "./global.js";

/** 配置目录名与文件名 */
export const CONFIG_DIR = ".igraph";
export const CONFIG_FILE = "config.json";

/** 环境变量名（凭据来源，禁止写入配置文件） */
export const ENV_API_KEY = "IGRAPH_API_KEY";
export const ENV_EMBEDDING_BASE_URL = "IGRAPH_EMBEDDING_BASE_URL";
export const ENV_LLM_BASE_URL = "IGRAPH_LLM_BASE_URL";

/** 返回 `<cwd>/.igraph/config.json` 的绝对路径 */
export function getConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, CONFIG_DIR, CONFIG_FILE);
}

/** 配置文件是否已存在 */
export function configExists(cwd: string = process.cwd()): boolean {
  return existsSync(getConfigPath(cwd));
}

/** 浅合并各节（用户配置覆盖默认值），足够 M0 使用 */
function mergeConfig(base: IGraphConfig, override: IGraphConfig): IGraphConfig {
  return {
    embedding: { ...base.embedding, ...override.embedding },
    llm: { ...base.llm, ...override.llm },
    parser: { ...base.parser, ...override.parser },
    retrieval: { ...base.retrieval, ...override.retrieval },
    multimodal: { ...base.multimodal, ...override.multimodal },
  };
}

/**
 * 从环境变量 + 全局配置收集凭据。环境变量优先级高于全局配置。
 * @param requireApiKey 为 true 时缺失 API Key 抛错（build/query 等需要联网的命令）。
 * @param globalCredentials 全局配置中的凭据（fallback）。
 */
export function loadCredentials(
  requireApiKey = true,
  globalCredentials?: Partial<Credentials>,
): Credentials {
  const envApiKey = process.env[ENV_API_KEY];
  const apiKey = envApiKey?.trim() || globalCredentials?.apiKey || "";
  if (requireApiKey && apiKey === "") {
    throw new ConfigValidationError(
      `缺少 API Key。请通过环境变量 ${ENV_API_KEY} 或 \`igraph config set apiKey <value>\` 提供`,
    );
  }
  const creds: Credentials = { apiKey };
  const embeddingBaseURL = process.env[ENV_EMBEDDING_BASE_URL] || globalCredentials?.embeddingBaseURL;
  const llmBaseURL = process.env[ENV_LLM_BASE_URL] || globalCredentials?.llmBaseURL;
  if (embeddingBaseURL) creds.embeddingBaseURL = embeddingBaseURL;
  if (llmBaseURL) creds.llmBaseURL = llmBaseURL;
  return creds;
}

/** 读取并校验磁盘上的配置文件；不存在时抛错 */
export function readConfigFile(cwd: string = process.cwd()): IGraphConfig {
  const path = getConfigPath(cwd);
  if (!existsSync(path)) {
    throw new ConfigValidationError(
      `未找到配置文件 ${path}，请先运行 \`igraph init\``,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new ConfigValidationError(
      `解析配置文件失败 ${path}：${(err as Error).message}`,
    );
  }
  const validated = validateConfig(parsed);
  return mergeConfig(DEFAULT_CONFIG, validated);
}

/**
 * 加载完整运行时配置：全局配置 + 项目配置 + 默认值 + 环境变量凭据。
 *
 * 合并优先级：环境变量 > 项目配置 > 全局配置 > 默认值
 *
 * @param requireApiKey 需要凭据的命令传 true。
 */
export function loadConfig(
  cwd: string = process.cwd(),
  requireApiKey = true,
): ResolvedConfig {
  // 1. 读取全局配置（不含 credentials 部分参与 IGraphConfig 合并）
  const global = readGlobalConfig();
  const globalPartial: Partial<IGraphConfig> = {};
  if (global.embedding) globalPartial.embedding = global.embedding as IGraphConfig["embedding"];
  if (global.llm) globalPartial.llm = global.llm as IGraphConfig["llm"];
  if (global.parser) globalPartial.parser = global.parser as IGraphConfig["parser"];
  if (global.retrieval) globalPartial.retrieval = global.retrieval as IGraphConfig["retrieval"];
  if (global.multimodal) globalPartial.multimodal = global.multimodal as IGraphConfig["multimodal"];

  // 2. 读取项目配置
  const projectConfig = readConfigFile(cwd);

  // 3. 合并：DEFAULT → 全局 → 项目（项目优先级最高）
  const base = mergeConfig(DEFAULT_CONFIG, globalPartial as IGraphConfig);
  const config = mergeConfig(base, projectConfig);

  // 4. 凭据：环境变量 > 全局配置 credentials
  const credentials = loadCredentials(requireApiKey, global.credentials);
  if (credentials.embeddingBaseURL) config.embedding.baseURL = credentials.embeddingBaseURL;
  if (credentials.llmBaseURL) config.llm.baseURL = credentials.llmBaseURL;

  return { ...config, credentials };
}