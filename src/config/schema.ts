/**
 * config/schema.ts — 配置类型定义与校验
 *
 * 说明：
 * - 这里定义的是「项目配置文件」(.igraph/config.json) 的结构。
 * - 凭据（API Key）**不在此结构中**，一律从环境变量注入（见 4.2）。
 * - M0 使用轻量手写校验，避免过早引入 zod 等运行时依赖；后续里程碑
 *   若需要更复杂的校验可平滑替换为 zod（类型定义已就绪）。
 */

// ── 各子配置的类型定义 ─────────────────────────────────────────

export interface EmbeddingConfig {
  /** TEI / OpenAI 兼容 Embedding 服务地址（不含密钥） */
  baseURL: string;
  /** 模型名，如 'bge-m3' */
  model: string;
  /** 向量维度，BGE-M3 默认 1024 */
  dimensions: number;
  /** 批量大小 */
  batchSize: number;
}

export interface LlmConfig {
  /** OpenAI 兼容 API 地址（不含密钥） */
  baseURL: string;
  /** 默认模型（node 级摘要） */
  model: string;
  /** file 级摘要用的更强模型（可选） */
  fileSummaryModel?: string;
  /** 采样温度，固定为 0 保证可复现 */
  temperature: number;
  /** 最大并发数 */
  maxConcurrency: number;
  /** prompt 版本号（摘要版本追踪） */
  promptVersion: string;
}

export interface ParserConfig {
  /** 需要解析的语言 */
  languages: string[];
  /** 包含的文件 glob */
  include: string[];
  /** 排除的文件 glob */
  exclude: string[];
}

export type FusionStrategy = "rrf";

export interface RetrievalConfig {
  /** 第一级粗筛 Top-K */
  fileTopK: number;
  /** 第二级精筛 Top-K */
  nodeTopK: number;
  /** fallback 阈值 */
  fallbackThreshold: number;
  /** 图谱展开跳数 */
  graphHops: number;
  /** 融合算法，MVP 固定 rrf（免归一化更鲁棒） */
  fusion: FusionStrategy;
  /** RRF 常数 k */
  rrfK: number;
  /** Dense 通道 RRF 项权重 */
  denseWeight: number;
  /** FTS5 通道 RRF 项权重 */
  ftsWeight: number;
  /** 独立资源检索 Top-K（直接搜索 resource_vectors，不依赖 resource_edges） */
  resourceTopK: number;
}

export interface MultimodalConfig {
  /** strong link 阈值 */
  strongLinkThreshold: number;
  /** weak link 阈值 */
  weakLinkThreshold: number;
  /** 是否用 LLM 二次确认 weak links */
  llmConfirmWeakLinks: boolean;
}

/** 项目配置文件（.igraph/config.json）完整结构 —— 不含任何凭据 */
export interface IGraphConfig {
  embedding: EmbeddingConfig;
  llm: LlmConfig;
  parser: ParserConfig;
  retrieval: RetrievalConfig;
  multimodal: MultimodalConfig;
}

/**
 * 运行时凭据 —— 仅来自环境变量，绝不来自配置文件。
 *   IGRAPH_API_KEY            —— LLM/Embedding 通用密钥（必需）
 *   IGRAPH_EMBEDDING_BASE_URL —— 可选，覆盖 embedding.baseURL
 *   IGRAPH_LLM_BASE_URL       —— 可选，覆盖 llm.baseURL
 */
export interface Credentials {
  apiKey: string;
  embeddingBaseURL?: string;
  llmBaseURL?: string;
}

/** 配置 + 凭据的合并结果（供各模块运行时使用） */
export interface ResolvedConfig extends IGraphConfig {
  credentials: Credentials;
}

// ── 轻量校验 ───────────────────────────────────────────────────

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

/**
 * 校验从磁盘读入的对象是否满足 IGraphConfig 结构。
 * 校验失败抛出 ConfigValidationError。
 */
export function validateConfig(raw: unknown): IGraphConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigValidationError("配置文件必须是一个 JSON 对象");
  }
  const obj = raw as Record<string, unknown>;

  const requiredSections = ["embedding", "llm", "parser", "retrieval", "multimodal"] as const;
  for (const section of requiredSections) {
    if (typeof obj[section] !== "object" || obj[section] === null) {
      throw new ConfigValidationError(`配置缺少必需的 "${section}" 节`);
    }
  }

  // 安全护栏：禁止在配置文件中出现任何形式的密钥字段
  const forbiddenKeys = ["apiKey", "api_key", "apikey", "token", "secret"];
  const scan = (o: Record<string, unknown>, path: string): void => {
    for (const [k, v] of Object.entries(o)) {
      if (forbiddenKeys.includes(k.toLowerCase())) {
        throw new ConfigValidationError(
          `配置文件中禁止出现凭据字段 "${path}${k}"，请改用环境变量 IGRAPH_API_KEY`,
        );
      }
      if (typeof v === "object" && v !== null) scan(v as Record<string, unknown>, `${path}${k}.`);
    }
  };
  scan(obj, "");

  return obj as unknown as IGraphConfig;
}