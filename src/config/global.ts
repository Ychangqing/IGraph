/**
 * config/global.ts — 全局配置读写（~/.igraph/config.json）
 *
 * 全局配置存储在用户 home 目录下 `~/.igraph/config.json`，包含：
 * - credentials（apiKey、baseURL 覆盖）
 * - 各模块的默认配置（embedding/llm/parser/retrieval/multimodal 的部分字段）
 *
 * 全局配置文件**允许**包含 credentials 字段（不同于项目级配置的安全约束 —
 * 项目级禁止凭据是防止提交到 git，全局配置在用户 home 目录不存在此风险）。
 *
 * 优先级：环境变量 > 项目级 .igraph/config.json > 全局 ~/.igraph/config.json
 */
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import type {
  Credentials,
  EmbeddingConfig,
  LlmConfig,
  ParserConfig,
  RetrievalConfig,
  MultimodalConfig,
} from "./schema.js";

/** 全局配置目录 */
export const GLOBAL_CONFIG_DIR = join(homedir(), ".igraph");

/** 全局配置文件路径 */
export const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, "config.json");

/** 全局配置结构（所有字段均可选） */
export interface GlobalConfig {
  credentials?: Partial<Credentials>;
  embedding?: Partial<EmbeddingConfig>;
  llm?: Partial<LlmConfig>;
  parser?: Partial<ParserConfig>;
  retrieval?: Partial<RetrievalConfig>;
  multimodal?: Partial<MultimodalConfig>;
}

/** 读取全局配置，不存在或解析失败返回空对象 */
export function readGlobalConfig(): GlobalConfig {
  if (!existsSync(GLOBAL_CONFIG_PATH)) return {};
  try {
    const raw = readFileSync(GLOBAL_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as GlobalConfig;
  } catch {
    return {};
  }
}

/** 写入全局配置（覆盖整个文件） */
export function writeGlobalConfig(config: GlobalConfig): void {
  mkdirSync(dirname(GLOBAL_CONFIG_PATH), { recursive: true });
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * 设置全局配置中的某个值。
 *
 * 支持的 key 路径：
 * - `apiKey` → credentials.apiKey
 * - `embeddingBaseURL` → credentials.embeddingBaseURL
 * - `llmBaseURL` → credentials.llmBaseURL
 * - `section.field` → config[section][field]（如 `embedding.baseURL`）
 */
export function setGlobalConfigValue(keyPath: string, value: string): void {
  const config = readGlobalConfig();

  // 顶层凭据快捷键
  if (keyPath === "apiKey") {
    config.credentials = { ...config.credentials, apiKey: value };
  } else if (keyPath === "embeddingBaseURL") {
    config.credentials = { ...config.credentials, embeddingBaseURL: value };
  } else if (keyPath === "llmBaseURL") {
    config.credentials = { ...config.credentials, llmBaseURL: value };
  } else {
    // section.field 格式
    const dotIdx = keyPath.indexOf(".");
    if (dotIdx === -1) {
      throw new Error(`无效的 key 路径：${keyPath}。格式为 section.field（如 embedding.baseURL）或 apiKey`);
    }
    const section = keyPath.slice(0, dotIdx) as keyof GlobalConfig;
    const field = keyPath.slice(dotIdx + 1);
    const validSections = ["embedding", "llm", "parser", "retrieval", "multimodal"];
    if (!validSections.includes(section)) {
      throw new Error(`无效的配置节：${section}。可用：${validSections.join(", ")}`);
    }
    const current = (config[section] ?? {}) as Record<string, unknown>;
    // 尝试解析数值和布尔值
    let parsed: unknown = value;
    if (value === "true") parsed = true;
    else if (value === "false") parsed = false;
    else if (/^\d+(\.\d+)?$/.test(value)) parsed = Number(value);
    current[field] = parsed;
    (config as Record<string, unknown>)[section] = current;
  }

  writeGlobalConfig(config);
}

/**
 * 获取全局配置中的某个值。
 */
export function getGlobalConfigValue(keyPath: string): unknown {
  const config = readGlobalConfig();

  if (keyPath === "apiKey") return config.credentials?.apiKey;
  if (keyPath === "embeddingBaseURL") return config.credentials?.embeddingBaseURL;
  if (keyPath === "llmBaseURL") return config.credentials?.llmBaseURL;

  const dotIdx = keyPath.indexOf(".");
  if (dotIdx === -1) return undefined;
  const section = keyPath.slice(0, dotIdx) as keyof GlobalConfig;
  const field = keyPath.slice(dotIdx + 1);
  const sectionObj = config[section];
  if (typeof sectionObj !== "object" || sectionObj === null) return undefined;
  return (sectionObj as Record<string, unknown>)[field];
}
