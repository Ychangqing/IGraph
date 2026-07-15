/**
 * llm-client.test.ts — LlmClient 重试与错误分类（mock fetch）
 *
 * 通过注入 fetchImpl / sleepImpl mock 验证：
 * - 可重试错误（429）先失败后成功，最终返回内容；
 * - 达到最大重试次数仍失败则抛出对应 LlmError；
 * - 不可重试错误（401 auth）立即抛出，不重试；
 * - 缺失 apiKey 构造即抛错。
 */
import { describe, it, expect, vi } from "vitest";
import { LlmClient, LlmError } from "../src/semantic/llm-client.js";

function jsonResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function errorResponse(status: number, body = ""): Response {
  return new Response(body, { status });
}

const baseOptions = {
  baseURL: "https://api.example.com/v1",
  model: "test-model",
  apiKey: "sk-test",
  retryBaseMs: 1,
};

describe("LlmClient - 构造校验", () => {
  it("缺失 apiKey 抛 auth 错误", () => {
    expect(() => new LlmClient({ ...baseOptions, apiKey: "" })).toThrow(
      LlmError,
    );
  });
});

describe("LlmClient - 重试", () => {
  it("429 后成功：重试一次并返回内容", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(429, "rate limited"))
      .mockResolvedValueOnce(jsonResponse("hello"));
    const sleepImpl = vi.fn(() => Promise.resolve());

    const client = new LlmClient({ ...baseOptions, fetchImpl, sleepImpl });
    const out = await client.complete({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(out).toBe("hello");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it("持续 500：达到 maxRetries 后抛 server 错误", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errorResponse(500, "boom"));
    const sleepImpl = vi.fn(() => Promise.resolve());

    const client = new LlmClient({
      ...baseOptions,
      maxRetries: 2,
      fetchImpl,
      sleepImpl,
    });

    await expect(
      client.complete({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ kind: "server" });
    // 首次 + 2 次重试 = 3 次
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it("网络异常可重试", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse("ok"));
    const sleepImpl = vi.fn(() => Promise.resolve());

    const client = new LlmClient({ ...baseOptions, fetchImpl, sleepImpl });
    const out = await client.complete({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(out).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("LlmClient - 不可重试错误", () => {
  it("401 立即抛 auth 错误，不重试", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errorResponse(401, "unauthorized"));
    const sleepImpl = vi.fn(() => Promise.resolve());

    const client = new LlmClient({ ...baseOptions, fetchImpl, sleepImpl });

    await expect(
      client.complete({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ kind: "auth" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("400 token 超限归类为 token_limit，不重试", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(errorResponse(400, "maximum context length exceeded"));
    const sleepImpl = vi.fn(() => Promise.resolve());

    const client = new LlmClient({ ...baseOptions, fetchImpl, sleepImpl });

    await expect(
      client.complete({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ kind: "token_limit" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("LlmClient - jsonMode", () => {
  it("jsonMode 时请求体带 response_format", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse("{}"));
    const client = new LlmClient({ ...baseOptions, fetchImpl });
    await client.complete({
      messages: [{ role: "user", content: "hi" }],
      jsonMode: true,
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.response_format).toEqual({ type: "json_object" });
  });
});