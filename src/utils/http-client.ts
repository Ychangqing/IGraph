/**
 * utils/http-client.ts — OpenAI 兼容原生 fetch 客户端的共享 HTTP 基础设施
 *
 * 背景（审查项 #10）：semantic/llm-client 与 vector/embedding-client 两个客户端
 * 的 HTTP 调用逻辑高度雷同——鉴权头、baseURL 拼接、超时中断、错误分类、指数
 * 退避重试。本模块抽取这些完全相同的部分，两客户端复用，业务差异（endpoint、
 * 请求体、响应解析、错误类型）仍保留在各自模块。
 *
 * 设计约束：
 * - 仅依赖 Node 18+ 内置 fetch，不引入 SDK。
 * - 凭据零硬编码：apiKey 由调用方注入（上层从环境变量 IGRAPH_API_KEY 读取）。
 * - 错误类型不在本模块固化：通过注入 `makeError` 工厂构造具体错误（LlmError /
 *   EmbeddingError），从而保持两客户端对外抛出的错误类型与 `instanceof` 语义不变。
 * - 重试/退避策略与原实现等价：首次 + maxRetries 次重试，延迟 = retryBaseMs * 2**attempt。
 */

/** 与两客户端共用的错误分类枚举 */
export type HttpErrorKind =
  | "rate_limit"
  | "token_limit"
  | "network"
  | "auth"
  | "server"
  | "unknown";

/** 错误构造附加选项 */
export interface MakeErrorOptions {
  status?: number;
  retryable?: boolean;
}

/**
 * 错误工厂：由各客户端注入，用于构造其专属错误类型（LlmError / EmbeddingError）。
 * 返回值必须是 Error 的子类且带 `retryable` 布尔字段，供重试循环判断。
 */
export type MakeError<E extends Error> = (
  message: string,
  kind: HttpErrorKind,
  options?: MakeErrorOptions,
) => E;

/** 判断某类错误是否默认可重试（与原两客户端一致的默认策略） */
export function isRetryableKind(kind: HttpErrorKind): boolean {
  return kind === "rate_limit" || kind === "network" || kind === "server";
}

/** 规范化 baseURL：去除尾部斜杠，避免与 endpoint 拼接出双斜杠 */
export function normalizeBaseURL(baseURL: string): string {
  return baseURL.replace(/\/+$/, "");
}

/** 默认退避 sleep 实现 */
export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 校验 apiKey 非空，缺失则用注入的工厂抛 auth 错误 */
export function assertApiKey<E extends Error>(
  apiKey: string,
  makeError: MakeError<E>,
  message: string,
): void {
  if (!apiKey || apiKey.trim() === "") {
    throw makeError(message, "auth", { retryable: false });
  }
}

/** 单次 HTTP POST（JSON）的配置 */
export interface HttpPostJsonConfig<E extends Error> {
  url: string;
  apiKey: string;
  body: unknown;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  makeError: MakeError<E>;
  /**
   * token 超限识别正则（作用于 400 响应体）。两客户端文案略有差异，故可配置。
   */
  tokenLimitPattern: RegExp;
}

/**
 * 执行单次 POST JSON 请求：处理超时中断、鉴权头、!res.ok 的错误分类与 JSON 解析。
 * 成功时返回已解析的 JSON（调用方按各自响应结构断言）。
 * 失败时抛出由 makeError 构造的错误（网络层归 'network'，HTTP 层按状态码分类）。
 */
export async function httpPostJson<T, E extends Error>(
  config: HttpPostJsonConfig<E>,
): Promise<T> {
  const { url, apiKey, body, timeoutMs, fetchImpl, makeError } = config;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // fetch 抛错通常是网络层（abort/超时/连接失败）。
    throw makeError(`网络请求失败：${(err as Error).message}`, "network", {
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw await classifyHttpError(res, config);
  }

  try {
    return (await res.json()) as T;
  } catch (err) {
    throw makeError(`解析响应 JSON 失败：${(err as Error).message}`, "unknown", {
      retryable: false,
    });
  }
}

/** 依据 HTTP 状态码与响应体分类错误（与两客户端原逻辑一致） */
async function classifyHttpError<E extends Error>(
  res: Response,
  config: HttpPostJsonConfig<E>,
): Promise<E> {
  const { makeError, tokenLimitPattern } = config;
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    // 忽略读取失败
  }
  const status = res.status;
  if (status === 429) {
    return makeError(`触发速率限制（429）：${bodyText}`, "rate_limit", {
      status,
      retryable: true,
    });
  }
  if (status === 401 || status === 403) {
    return makeError(`鉴权失败（${status}）：${bodyText}`, "auth", {
      status,
      retryable: false,
    });
  }
  if (status === 400 && tokenLimitPattern.test(bodyText)) {
    return makeError(`超出 token 上限（400）：${bodyText}`, "token_limit", {
      status,
      retryable: false,
    });
  }
  if (status >= 500) {
    return makeError(`服务端错误（${status}）：${bodyText}`, "server", {
      status,
      retryable: true,
    });
  }
  return makeError(`请求失败（${status}）：${bodyText}`, "unknown", {
    status,
    retryable: false,
  });
}

/** 重试执行器配置 */
export interface RetryConfig<E extends Error> {
  maxRetries: number;
  retryBaseMs: number;
  sleep: (ms: number) => Promise<void>;
  makeError: MakeError<E>;
  /** 判断捕获到的异常是否为本客户端的错误类型（用于区分是否需二次分类） */
  isOwnError: (err: unknown) => err is E;
  /** 判断错误是否可重试（读取错误上的 retryable 字段） */
  isRetryable: (err: E) => boolean;
}

/**
 * 通用重试循环：首次 + maxRetries 次重试，延迟 = retryBaseMs * 2**attempt。
 * 捕获到非本客户端错误时用 makeError 归类为不可重试的 'unknown'。
 */
export async function withRetry<T, E extends Error>(
  operation: () => Promise<T>,
  config: RetryConfig<E>,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (err) {
      const e: E = config.isOwnError(err)
        ? err
        : config.makeError(
            `未知错误：${err instanceof Error ? err.message : String(err)}`,
            "unknown",
            { retryable: false },
          );
      if (!config.isRetryable(e) || attempt >= config.maxRetries) {
        throw e;
      }
      const delay = config.retryBaseMs * 2 ** attempt;
      await config.sleep(delay);
      attempt += 1;
    }
  }
}