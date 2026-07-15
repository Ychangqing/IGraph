/**
 * embedding-client.test.ts — EmbeddingClient（mock fetch）
 *
 * 覆盖：
 * - 缺失 apiKey 构造即抛 auth 错误；
 * - 正常向量化返回顺序与输入对应；
 * - 服务乱序返回（带 index）能按 index 归位；
 * - 401 auth 立即抛出且不重试；429 可重试后成功；
 * - 维度校验失败抛错。
 */
import { describe, it, expect, vi } from "vitest";
import { EmbeddingClient, EmbeddingError } from "../src/vector/embedding-client.js";

function embedResponse(
  data: Array<{ index?: number; embedding: number[] }>,
): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const baseOptions = {
  baseURL: "https://api.example.com/v1",
  model: "bge-m3",
  apiKey: "sk-test",
  retryBaseMs: 1,
};

describe("EmbeddingClient - 构造校验", () => {
  it("缺失 apiKey 抛 auth 错误", () => {
    expect(() => new EmbeddingClient({ ...baseOptions, apiKey: "" })).toThrow(
      EmbeddingError,
    );
  });
});

describe("EmbeddingClient - 向量化", () => {
  it("按输入顺序返回向量", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      embedResponse([
        { index: 0, embedding: [1, 0] },
        { index: 1, embedding: [0, 1] },
      ]),
    );
    const client = new EmbeddingClient({ ...baseOptions, fetchImpl });
    const out = await client.embed(["a", "b"]);
    expect(out).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("服务乱序返回时按 index 归位", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      embedResponse([
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ]),
    );
    const client = new EmbeddingClient({ ...baseOptions, fetchImpl });
    const out = await client.embed(["a", "b"]);
    expect(out[0]).toEqual([1, 0]);
    expect(out[1]).toEqual([0, 1]);
  });

  it("embedOne 返回单条向量", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(embedResponse([{ index: 0, embedding: [1, 2, 3] }]));
    const client = new EmbeddingClient({ ...baseOptions, fetchImpl });
    expect(await client.embedOne("hi")).toEqual([1, 2, 3]);
  });

  it("空输入返回空数组且不发请求", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new EmbeddingClient({ ...baseOptions, fetchImpl });
    expect(await client.embed([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("维度不符抛错", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(embedResponse([{ index: 0, embedding: [1, 2] }]));
    const client = new EmbeddingClient({
      ...baseOptions,
      fetchImpl,
      dimensions: 3,
    });
    await expect(client.embed(["a"])).rejects.toThrow(EmbeddingError);
  });
});

describe("EmbeddingClient - 错误与重试", () => {
  it("401 auth 立即抛出，不重试", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const sleepImpl = vi.fn(() => Promise.resolve());
    const client = new EmbeddingClient({ ...baseOptions, fetchImpl, sleepImpl });
    await expect(client.embed(["a"])).rejects.toThrow(EmbeddingError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("429 后成功：重试一次并返回", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rate", { status: 429 }))
      .mockResolvedValueOnce(embedResponse([{ index: 0, embedding: [1] }]));
    const sleepImpl = vi.fn(() => Promise.resolve());
    const client = new EmbeddingClient({ ...baseOptions, fetchImpl, sleepImpl });
    expect(await client.embed(["a"])).toEqual([[1]]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});