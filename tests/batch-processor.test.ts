/**
 * batch-processor.test.ts — 摘要批量处理器（断点续传 / 错误标记）
 *
 * 覆盖：
 * - 只处理 summary_status='pending' 的文件，跳过已 'done'（断点续传）；
 * - summarize 抛错的文件被标记 'error'，不影响其他文件；
 * - 成功文件写入 file/node 摘要并置 'done'；
 * - 使用 handleSigint:false 避免污染全局信号处理。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  openMemoryDatabase,
  closeDatabase,
  upsertFile,
  insertNodes,
  getNodesByFile,
  listFiles,
  updateFileSummary,
  countFilesBySummaryStatus,
  type DB,
} from "../src/graph/index.js";
import {
  processPendingFiles,
  type FileSummaryOutput,
  type SummarizeFile,
} from "../src/semantic/batch-processor.js";

let db: DB | undefined;

afterEach(() => {
  if (db) {
    closeDatabase(db);
    db = undefined;
  }
});

function seedFile(database: DB, path: string): number {
  const fileId = upsertFile(database, { filePath: path, hash: "h" });
  insertNodes(database, [
    { fileId, name: "foo", kind: "function", signature: "foo()" },
  ]);
  return fileId;
}

function okSummary(model = "test"): FileSummaryOutput {
  return {
    fileSummary: "文件摘要",
    nodeSummaries: new Map([["foo", "foo 的摘要"]]),
    model,
    promptVersion: "v1.0",
  };
}

describe("processPendingFiles - 断点续传", () => {
  it("跳过已 done 的文件，仅处理 pending", async () => {
    db = openMemoryDatabase();
    const idA = seedFile(db, "src/a.ts");
    seedFile(db, "src/b.ts");

    // 将 a 预先标记为 done（模拟上次已完成）
    updateFileSummary(db, {
      fileId: idA,
      fileSummary: "旧摘要",
      status: "done",
      model: "prev",
      promptVersion: "v1.0",
    });

    const summarize = vi.fn<SummarizeFile>(() => Promise.resolve(okSummary()));
    const result = await processPendingFiles(db, summarize, {
      handleSigint: false,
    });

    // 只有 b 是 pending
    expect(result.total).toBe(1);
    expect(result.done).toBe(1);
    expect(summarize).toHaveBeenCalledTimes(1);
    const calledPaths = summarize.mock.calls.map((c) => c[0].file_path);
    expect(calledPaths).toEqual(["src/b.ts"]);
  });
});

describe("processPendingFiles - 落库与状态机", () => {
  it("成功文件写入摘要并置 done", async () => {
    db = openMemoryDatabase();
    seedFile(db, "src/a.ts");

    const result = await processPendingFiles(
      db,
      () => Promise.resolve(okSummary("m1")),
      { handleSigint: false },
    );

    expect(result.done).toBe(1);
    const file = listFiles(db)[0];
    expect(file?.summary_status).toBe("done");
    expect(file?.file_summary).toBe("文件摘要");
    expect(file?.summary_model).toBe("m1");
    const node = getNodesByFile(db, file?.id ?? 0)[0];
    expect(node?.summary_status).toBe("done");
    expect(node?.summary).toBe("foo 的摘要");
  });

  it("summarize 抛错的文件标记 error，不影响其他文件", async () => {
    db = openMemoryDatabase();
    seedFile(db, "src/good.ts");
    seedFile(db, "src/bad.ts");

    const summarize = vi.fn((file: { file_path: string }) => {
      if (file.file_path === "src/bad.ts") {
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve(okSummary());
    });

    const result = await processPendingFiles(db, summarize, {
      handleSigint: false,
    });

    expect(result.total).toBe(2);
    expect(result.done).toBe(1);
    expect(result.failed).toBe(1);

    const counts = countFilesBySummaryStatus(db);
    expect(counts.done).toBe(1);
    expect(counts.error).toBe(1);
  });
});