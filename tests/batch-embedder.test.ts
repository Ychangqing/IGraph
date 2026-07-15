/**
 * batch-embedder.test.ts — 摘要向量化批处理（断点续传）
 *
 * 覆盖：
 * - 断点续传：只处理 summary_status='done' 且 embedding_status != 'done' 的记录，
 *   跳过 embedding_status='done'。
 * - 单批失败：client.embed 抛错时该批标记 embedding_status='error'，不中断整体，
 *   且不影响后续 scope。
 * - 成功落库后 embedding_status='done' + embedding_model 写入，向量入表。
 *
 * 使用注入的 mock EmbeddingClient（返回确定性单位向量），不依赖真实服务。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { openMemoryDatabase, closeDatabase, type DB } from "../src/graph/index.js";
import { upsertFile, updateFileSummary } from "../src/graph/files.js";
import {
  insertNodes,
  updateNodeSummaries,
  setNodeEmbeddingStatus,
} from "../src/graph/nodes.js";
import { embedPending } from "../src/vector/batch-embedder.js";
import { countVectors } from "../src/vector/store.js";
import type { EmbeddingClient } from "../src/vector/embedding-client.js";

const DIM = 1024;

/** 第 axis 维为 1 的单位向量 */
function unitVector(axis: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[axis % DIM] = 1;
  return v;
}

/**
 * 构造一个满足 embedPending 所需接口的 mock 客户端。
 * embed 按输入长度返回等量确定性向量（每条用不同轴）。
 */
function makeClient(
  embed: (texts: readonly string[]) => Promise<number[][]>,
  model = "mock-embed",
  batchSize = 32,
): EmbeddingClient {
  return { embed, model, batchSize } as unknown as EmbeddingClient;
}

let db: DB | undefined;
afterEach(() => {
  if (db) {
    closeDatabase(db);
    db = undefined;
  }
});

/** 插入一个 summary 已完成的文件，返回 id */
function seedFile(path: string, summary: string): number {
  const id = upsertFile(db!, { filePath: path, language: "ts", hash: "h" });
  updateFileSummary(db!, {
    fileId: id,
    fileSummary: summary,
    status: "done",
    model: "sum",
    promptVersion: "v1",
  });
  return id;
}

/** 插入一个 summary 已完成的节点，返回 id */
function seedNode(fileId: number, name: string, summary: string): number {
  const [id] = insertNodes(db!, [
    { fileId, name, kind: "function" },
  ]);
  updateNodeSummaries(db!, [
    { nodeId: id!, summary, status: "done", model: "sum", promptVersion: "v1" },
  ]);
  return id!;
}

describe("embedPending - 断点续传", () => {
  it("只处理 pending，跳过 embedding_status='done'", async () => {
    db = openMemoryDatabase();
    const f1 = seedFile("a.ts", "file a summary");
    const n1 = seedNode(f1, "foo", "foo summary");
    const n2 = seedNode(f1, "bar", "bar summary");
    // n2 已向量化完成，应被跳过
    setNodeEmbeddingStatus(db, n2, "done", "prev-model");

    const embed = vi.fn(async (texts: readonly string[]) =>
      texts.map((_, i) => unitVector(i)),
    );
    const client = makeClient(embed);

    const result = await embedPending(db, client);

    expect(result.files).toEqual({ total: 1, done: 1, failed: 0 });
    // 只有 n1 待处理（n2 已 done 被跳过）
    expect(result.nodes).toEqual({ total: 1, done: 1, failed: 0 });

    // 向量落库：file_vectors 1 条、node_vectors 1 条（仅 n1）
    expect(countVectors(db, "file_vectors")).toBe(1);
    expect(countVectors(db, "node_vectors")).toBe(1);

    // n1 状态 done + 模型；n2 保持原模型不变
    const n1Row = db
      .prepare("SELECT embedding_status AS s, embedding_model AS m FROM nodes WHERE id = ?")
      .get(n1) as { s: string; m: string | null };
    expect(n1Row.s).toBe("done");
    expect(n1Row.m).toBe("mock-embed");
    void f1;
  });

  it("summary 未完成的节点不参与向量化", async () => {
    db = openMemoryDatabase();
    const f1 = seedFile("a.ts", "file a summary");
    // 节点无 summary（summary_status 默认 pending）
    insertNodes(db, [{ fileId: f1, name: "nosum", kind: "function" }]);

    const embed = vi.fn(async (texts: readonly string[]) =>
      texts.map((_, i) => unitVector(i)),
    );
    const result = await embedPending(db, makeClient(embed));

    expect(result.nodes.total).toBe(0);
    expect(countVectors(db, "node_vectors")).toBe(0);
  });
});

describe("embedPending - 容错", () => {
  it("单批失败标记 error，不中断后续 scope", async () => {
    db = openMemoryDatabase();
    const f1 = seedFile("a.ts", "file a summary");
    const n1 = seedNode(f1, "foo", "foo summary");

    // file 批抛错，node 批成功：batchSize=1 使二者分批独立
    const embed = vi.fn(async (texts: readonly string[]) => {
      const text = texts[0] ?? "";
      if (text.includes("file a summary")) {
        throw new Error("simulated embedding failure");
      }
      return texts.map((_, i) => unitVector(i));
    });
    const client = makeClient(embed, "mock-embed", 1);

    const result = await embedPending(db, client);

    // file 失败
    expect(result.files).toEqual({ total: 1, done: 0, failed: 1 });
    // node 仍成功（未被中断）
    expect(result.nodes).toEqual({ total: 1, done: 1, failed: 0 });

    const fRow = db
      .prepare("SELECT embedding_status AS s FROM files WHERE id = ?")
      .get(f1) as { s: string };
    expect(fRow.s).toBe("error");
    expect(countVectors(db, "file_vectors")).toBe(0);
    expect(countVectors(db, "node_vectors")).toBe(1);
    void n1;
  });
});