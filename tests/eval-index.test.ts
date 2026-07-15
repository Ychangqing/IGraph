/**
 * eval-index.test.ts — 评测入口（loadEvalCases / runEval）集成测试
 *
 * 覆盖：
 * - loadEvalCases 解析数组与 {queries:[]} 两种格式、校验非法样本
 * - runEval 用注入的 retrieveFn 复用 formatter → 指标聚合（真实内存图谱）
 * - 优雅降级：forceMode="fts5-only" 时报告 note 说明降级
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  openMemoryDatabase,
  closeDatabase,
  upsertFile,
  insertNodes,
  type DB,
} from "../src/graph/index.js";
import { DEFAULT_CONFIG } from "../src/config/index.js";
import type { ResolvedConfig } from "../src/config/schema.js";
import type { SearchResponse, SearchResult } from "../src/retrieval/search.js";
import { loadEvalCases, runEval } from "../src/eval/index.js";

let db: DB | undefined;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "igraph-eval-"));
});

afterEach(() => {
  if (db) {
    closeDatabase(db);
    db = undefined;
  }
  rmSync(tmp, { recursive: true, force: true });
});

/** 构造无密钥的运行时配置 */
const makeConfig = (): ResolvedConfig => ({
  ...DEFAULT_CONFIG,
  credentials: { apiKey: "" },
});

/** 构造一条检索结果 */
const hit = (nodeId: number, rrfScore: number): SearchResult => ({
  nodeId,
  rrfScore,
  denseRank: null,
  ftsRank: 0,
  matchChannel: "fts5",
  denseSimilarity: null,
});

const response = (results: SearchResult[]): SearchResponse => ({
  results,
  diagnostics: {
    candidateFileIds: [],
    maxDenseSimilarity: null,
    fallbackTriggered: true,
  },
});

describe("loadEvalCases", () => {
  it("解析 {queries:[]} 格式并保留 expected 字段", () => {
    const p = join(tmp, "q.json");
    writeFileSync(
      p,
      JSON.stringify({
        queries: [
          { query: "创建用户", expected_nodes: ["createUser"], expected_files: ["a.ts"] },
        ],
      }),
    );
    const cases = loadEvalCases(p);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.expected_nodes).toEqual(["createUser"]);
    expect(cases[0]!.expected_files).toEqual(["a.ts"]);
  });

  it("解析裸数组格式", () => {
    const p = join(tmp, "q.json");
    writeFileSync(p, JSON.stringify([{ query: "x", expected_nodes: [] }]));
    expect(loadEvalCases(p)).toHaveLength(1);
  });

  it("缺少 query 字段时抛错", () => {
    const p = join(tmp, "q.json");
    writeFileSync(p, JSON.stringify([{ expected_nodes: ["x"] }]));
    expect(() => loadEvalCases(p)).toThrow(/query/);
  });
});

describe("runEval - 注入检索函数", () => {
  it("基于真实内存图谱计算 Recall@K 与 MRR", async () => {
    db = openMemoryDatabase();
    const fileId = upsertFile(db, { filePath: "src/service.ts", hash: "h" });
    insertNodes(db, [
      { fileId, name: "createUser", kind: "function" }, // nodeId=1
      { fileId, name: "normalizeName", kind: "function" }, // nodeId=2
    ]);

    // 第一条命中首位（RR=1，recall=1）；第二条命中第二位（RR=0.5，recall=1）
    const result = await runEval({
      db,
      config: makeConfig(),
      cases: [
        { query: "创建用户", expected_nodes: ["createUser"] },
        { query: "规范化", expected_nodes: ["normalizeName"] },
      ],
      k: 5,
      retrieveFn: (q) =>
        q === "创建用户"
          ? response([hit(1, 0.02), hit(2, 0.01)])
          : response([hit(1, 0.02), hit(2, 0.01)]),
    });

    expect(result.report.totalCount).toBe(2);
    expect(result.report.validCount).toBe(2);
    expect(result.report.recallAtK).toBe(1); // 两条都命中
    expect(result.report.mrr).toBeCloseTo((1 + 0.5) / 2, 6); // (1/1 + 1/2)/2
  });

  it("forceMode=fts5-only 时报告标注降级模式", async () => {
    db = openMemoryDatabase();
    const fileId = upsertFile(db, { filePath: "src/a.ts", hash: "h" });
    insertNodes(db, [{ fileId, name: "createUser", kind: "function" }]);

    const result = await runEval({
      db,
      config: makeConfig(),
      cases: [{ query: "创建用户", expected_nodes: ["createUser"] }],
      forceMode: "fts5-only",
      retrieveFn: (_q) => response([hit(1, 0.02)]),
    });

    expect(result.mode).toBe("fts5-only");
    expect(result.report.recallAtK).toBe(1);
  });
});