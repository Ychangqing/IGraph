/**
 * semantic/llm-client.ts — OpenAI 兼容 Chat Completions 客户端
 *
 * 设计要点：
 * - 仅依赖 Node 18+ 内置 fetch，不引入 openai SDK，保持依赖轻量（与项目
 *   「避免过早引入运行时依赖」的约定一致）。
 * - 凭据零硬编码：apiKey 由调用方从环境变量 IGRAPH_API_KEY 注入，本模块
 *   不读取任何配置文件。
 * - temperature 固定 0 保证可复现。
 * - 重试：对可重试错误（rate limit / network / 5xx）做最多 maxRetries 次
 *   指数退避重试；不可重试错误（如 token limit / 4xx auth）直接抛出。
 * - 错误分类：LlmError.kind ∈ 'rate_limit' | 'token_limit' | 'network'
 *   | 'auth' | 'server' | 'unknown'，供上层决定是否重试与如何提示。
 *
 * HTTP 基础设施（鉴权头 / baseURL 拼接 / 超时中断 / 状态码分类 / 退避重试）
 * 抽取至 utils/http-client（审查项 #10），与 embedding-client 共用；本模块只
 * 保留 chat/completions 的 endpoint 与请求/响应结构等业务差异。
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

/** LLM 错误分类 */
export type LlmErrorKind = HttpErrorKind;

/** 带分类信息的 LLM 错误 */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status: number | undefined;
  /** 该错误是否值得重试 */
  readonly retryable: boolean;

  constructor(
    message: string,
    kind: LlmErrorKind,
    options: MakeErrorOptions = {},
  ) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.status = options.status;
    this.retryable = options.retryable ?? isRetryableKind(kind);
  }
}

/** 一条对话消息 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 单次补全请求参数 */
export interface ChatCompletionParams {
  /** 覆盖默认模型（如 file 级用更强模型） */
  model?: string;
  messages: ChatMessage[];
  /** 是否要求 JSON 对象输出（OpenAI response_format） */
  jsonMode?: boolean;
}

/** LLM 客户端配置 */
export interface LlmClientOptions {
  baseURL: string;
  model: string;
  apiKey: string;
  /** 采样温度，默认 0 */
  temperature?: number;
  /** 最大重试次数（不含首次），默认 3 */
  maxRetries?: number;
  /** 首次退避基数（毫秒），默认 500，之后指数增长 */
  retryBaseMs?: number;
  /** 单次请求超时（毫秒），默认 60000 */
  timeoutMs?: number;
  /**
   * 可注入的 fetch 实现（测试用 mock）。默认使用全局 fetch。
   */
  fetchImpl?: typeof fetch;
  /** 退避 sleep 实现（测试可注入以跳过真实等待） */
  sleepImpl?: (ms: number) => Promise<void>;
}

/** OpenAI Chat Completions 响应的最小结构 */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/** 识别 400 响应体中的 token 超限特征 */
const TOKEN_LIMIT_PATTERN = /max.*token|context length|token.*exceed/i;

/**
 * OpenAI 兼容 LLM 客户端。线程无关，可复用。
 */
export class LlmClient {
  private readonly baseURL: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly temperature: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: LlmClientOptions) {
    assertApiKey(
      options.apiKey,
      (msg, kind, opts) => new LlmError(msg, kind, opts),
      "缺少 API Key：请通过环境变量 IGRAPH_API_KEY 提供，或使用 --no-llm 降级模式",
    );
    this.baseURL = normalizeBaseURL(options.baseURL);
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.temperature = options.temperature ?? 0;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 500;
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleep = options.sleepImpl ?? defaultSleep;
  }

   /**
   * 发起一次 Chat Completion，返回助手文本内容。
   * 内部处理重试与错误分类（复用 http-client 的通用退避循环）。
   */
  async complete(params: ChatCompletionParams): Promise<string> {
    return withRetry(() => this.doRequest(params), {
      maxRetries: this.maxRetries,
      retryBaseMs: this.retryBaseMs,
      sleep: this.sleep,
      makeError: (msg, kind, opts) => new LlmError(msg, kind, opts),
      isOwnError: (err): err is LlmError => err instanceof LlmError,
      isRetryable: (err) => err.retryable,
    });
  }

  /** 执行单次 HTTP 请求并解析响应 */
  private async doRequest(params: ChatCompletionParams): Promise<string> {
    const json = await httpPostJson<ChatCompletionResponse, LlmError>({
      url: `${this.baseURL}/chat/completions`,
      apiKey: this.apiKey,
      body: {
        model: params.model ?? this.model,
        temperature: this.temperature,
        messages: params.messages,
        ...(params.jsonMode ? { response_format: { type: "json_object" } } : {}),
      },
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      makeError: (msg, kind, opts) => new LlmError(msg, kind, opts),
      tokenLimitPattern: TOKEN_LIMIT_PATTERN,
    });

    const content = json.choices?.[0]?.message?.content;
    if (content === undefined || content === null) {
      throw new LlmError("LLM 响应缺少 choices[0].message.content", "unknown", {
        retryable: false,
      });
    }
    return content;
  }
}