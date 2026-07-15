/**
 * vector/embedding-client.ts — OpenAI 兼容 Embedding 客户端
 *
 * 设计要点（与 semantic/llm-client 风格一致）：
 * - 仅依赖 Node 18+ 内置 fetch，不引入 openai SDK。
 * - 目标服务：BGE-M3 via TEI，OpenAI 兼容 `POST /v1/embeddings`，仅 Dense 输出，
 *   默认 1024 维。
 * - 凭据零硬编码：apiKey 由调用方从环境变量 IGRAPH_API_KEY 注入。
 * - 批量：一次请求可携带多条 input（TEI/OpenAI 均支持数组 input）；上层按
 *   batchSize 切分后逐批调用。
 * - 重试：对可重试错误（rate limit / network / 5xx）指数退避重试；不可重
 *   错误（token limit / 4xx auth）直接抛出。
 * - 错误分类：EmbeddingError.kind ∈ 'rate_limit' | 'token_limit' | 'network'
 *   | 'auth' | 'server' | 'unknown'。
 * - 测试用依赖注入 mock（fetchImpl / sleepImpl）。
 *
 * HTTP 基础设施（鉴权头 / baseURL 拼接 / 超时中断 / 状态码分类 / 退避重试）
 * 抽取至 utils/http-client（审查项 #10），与 llm-client 共用；本模块只保留
 * embeddings 的 endpoint、请求体与「按 index 归位 + 维度校验」的响应处理差异。
 */
import {
  assertApiKey,
  defaultSleep,
  httpPostJson,
  isRetryableKind,
  normalizeBaseURL,
  withRetry,
  type HttpErrorKind,
  type MakeErrorOptions,
} from "../utils/http-client.js";

/** Embedding 错误分类 */
export type EmbeddingErrorKind = HttpErrorKind;

/** 带分类信息的 Embedding 错误 */
export class EmbeddingError extends Error {
  readonly kind: EmbeddingErrorKind;
  readonly status: number | undefined;
  /** 该错误是否值得重试 */
  readonly retryable: boolean;

  constructor(
    message: string,
    kind: EmbeddingErrorKind,
    options: MakeErrorOptions = {},
  ) {
    super(message);
    this.name = "EmbeddingError";
    this.kind = kind;
    this.status = options.status;
    this.retryable = options.retryable ?? isRetryableKind(kind);
  }
}

/** Embedding 客户端配置 */
export interface EmbeddingClientOptions {
  baseURL: string;
  model: string;
  apiKey: string;
  /** 期望的向量维度（用于校验响应），默认不校验 */
  dimensions?: number;
  /** 每批文本数（供上层批处理参考，默认 32） */
  batchSize?: number;
  /** 最大重试次数（不含首次），默认 3 */
  maxRetries?: number;
  /** 首次退避基数（毫秒），默认 500，之后指数增长 */
  retryBaseMs?: number;
  /** 单次请求超时（毫秒），默认 60000 */
  timeoutMs?: number;
  /** 可注入的 fetch 实现（测试用 mock）。默认使用全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** 退避 sleep 实现（测试可注入以跳过真实等待） */
  sleepImpl?: (ms: number) => Promise<void>;
}

/** OpenAI Embeddings 响应的小结构 */
interface EmbeddingsResponse {
  data?: Array<{ index?: number; embedding?: number[] }>;
}

/** 识别 400 响应体中的 token 超限特征（较 llm 端多 `too long`） */
const TOKEN_LIMIT_PATTERN = /max.*token|context length|token.*exceed|too long/i;

/**
 * OpenAI 兼容 Embedding 客户端。无状态，可复用。
 */
export class EmbeddingClient {
  private readonly baseURL: string;
  readonly model: string;
  readonly batchSize: number;
  private readonly apiKey: string;
  private readonly dimensions: number | undefined;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: EmbeddingClientOptions) {
    assertApiKey(
      options.apiKey,
      (msg, kind, opts) => new EmbeddingError(msg, kind, opts),
      "缺少 API Key：请通过环境变量 IGRAPH_API_KEY 提供",
    );
    this.baseURL = normalizeBaseURL(options.baseURL);
    this.model = options.model;
    this.batchSize = options.batchSize ?? 32;
    this.apiKey = options.apiKey;
    this.dimensions = options.dimensions;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 500;
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleep = options.sleepImpl ?? defaultSleep;
  }

  /**
   * 为一批文本生成 Dense 向量。返回顺序与输入 texts 对应。
   * 内部处理重试与错误分类；空输入返回空数组。
   */
  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return withRetry(() => this.doRequest(texts), {
      maxRetries: this.maxRetries,
      retryBaseMs: this.retryBaseMs,
      sleep: this.sleep,
      makeError: (msg, kind, opts) => new EmbeddingError(msg, kind, opts),
      isOwnError: (err): err is EmbeddingError => err instanceof EmbeddingError,
      isRetryable: (err) => err.retryable,
    });
  }

  /** 便捷方法：为单条文本生成向量 */
  async embedOne(text: string): Promise<number[]> {
    const [vec] = await this.embed([text]);
    if (vec === undefined) {
      throw new EmbeddingError("Embedding 响应为空", "unknown", { retryable: false });
    }
    return vec;
  }

  /** 执行单次 HTTP 请求并解析响应，按 index 复原顺序 */
  private async doRequest(texts: readonly string[]): Promise<number[][]> {
    const json = await httpPostJson<EmbeddingsResponse, EmbeddingError>({
      url: `${this.baseURL}/embeddings`,
      apiKey: this.apiKey,
      body: {
        model: this.model,
        input: [...texts],
        ...(this.dimensions !== undefined ? { dimensions: this.dimensions } : {}),
      },
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      makeError: (msg, kind, opts) => new EmbeddingError(msg, kind, opts),
      tokenLimitPattern: TOKEN_LIMIT_PATTERN,
    });

    const data = json.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new EmbeddingError(
        `Embedding 响应条目数（${data?.length ?? 0}）与输入（${texts.length}）不一致`,
        "unknown",
        { retryable: false },
      );
    }
    // 按 index 归位（服务可能乱序返回）；无 index 时按数组顺序。
    const out: number[][] = new Array(texts.length);
    data.forEach((item, i) => {
      const idx = typeof item.index === "number" ? item.index : i;
      const embedding = item.embedding;
      if (!Array.isArray(embedding)) {
        throw new EmbeddingError(`第 ${idx} 条缺少 embedding 数组`, "unknown", {
          retryable: false,
        });
      }
      if (this.dimensions !== undefined && embedding.length !== this.dimensions) {
        throw new EmbeddingError(
          `向量维度不符：期望 ${this.dimensions}，实际 ${embedding.length}`,
          "unknown",
          { retryable: false },
        );
      }
      out[idx] = embedding;
    });
    return out;
  }
}