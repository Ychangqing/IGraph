/**
 * metrics.test.ts — eval/metrics 纯函数单测
 *
 * 覆盖：
 * - Recall@K 命中占比、K 截断、大小写/空白不敏感
 * - MRR 首命中排名（不受 K 截断）
 * - 空 expected 视为无效样本（不计入均值分母）
 * - aggregateReport 有效样本求均值、全量样本求耗时
 */
import { describe, expect, it } from "vitest";
import {
  aggregateReport,
  evaluateCase,
  type CaseMetric,
  type RankedResult,
} from "../src/eval/metrics.js";

const r = (name: string): RankedResult => ({ name, filePath: null });

describe("evaluateCase", () => {
  it("命中全部 expected 时 recall=1，首位命中 RR=1", () => {
    const results = [r("createUser"), r("formatUser")];
    const m = evaluateCase(results, ["createUser"], 10);
    expect(m.recall).toBe(1);
    expect(m.reciprocalRank).toBe(1);
    expect(m.firstHitRank).toBe(1);
  });

  it("命中在第 3 位时 RR=1/3", () => {
    const results = [r("a"), r("b"), r("createUser")];
    const m = evaluateCase(results, ["createUser"], 10);
    expect(m.reciprocalRank).toBeCloseTo(1 / 3, 6);
    expect(m.firstHitRank).toBe(3);
  });

  it("多 expected 部分命中时 recall 为占比", () => {
    const results = [r("createUser"), r("x")];
    const m = evaluateCase(results, ["createUser", "createUsers"], 10);
    expect(m.recall).toBe(0.5);
  });

  it("Recall@K 受 K 截断，但 MRR 不受截断", () => {
    const results = [r("a"), r("b"), r("createUser")];
    const m = evaluateCase(results, ["createUser"], 2);
    expect(m.recall).toBe(0); // 前 2 条无命中
    expect(m.firstHitRank).toBe(3); // 全量首命中仍在第 3 位
    expect(m.reciprocalRank).toBeCloseTo(1 / 3, 6);
  });

  it("名称比较大小写/空白不敏感", () => {
    const results = [r("  CreateUser ")];
    const m = evaluateCase(results, ["createuser"], 10);
    expect(m.recall).toBe(1);
  });

  it("无命中时 recall=0、RR=0、firstHitRank=null", () => {
    const m = evaluateCase([r("x")], ["createUser"], 10);
    expect(m.recall).toBe(0);
    expect(m.reciprocalRank).toBe(0);
    expect(m.firstHitRank).toBeNull();
  });

  it("空 expected 返回 null（不适用，区别于零召回）", () => {
    const m = evaluateCase([r("x")], [], 10);
    expect(m.recall).toBeNull();
    expect(m.reciprocalRank).toBeNull();
    expect(m.firstHitRank).toBeNull();
  });
});

describe("aggregateReport", () => {
  const mk = (over: Partial<CaseMetric>): CaseMetric => ({
    query: "q",
    recall: 0,
    reciprocalRank: 0,
    firstHitRank: null,
    elapsedMs: 0,
    empty: false,
    ...over,
  });

  it("仅对有效样本求 Recall/MRR 均值，全量样本求耗时均值", () => {
    const cases: CaseMetric[] = [
      mk({ recall: 1, reciprocalRank: 1, elapsedMs: 10 }),
      mk({ recall: 0, reciprocalRank: 0, elapsedMs: 20 }),
      mk({ recall: null, reciprocalRank: null, elapsedMs: 30, empty: true }),
    ];
    const report = aggregateReport(cases, 5);
    expect(report.k).toBe(5);
    expect(report.totalCount).toBe(3);
    expect(report.validCount).toBe(2); // 排除 1 条空样本
    expect(report.recallAtK).toBe(0.5); // (1+0)/2
    expect(report.mrr).toBe(0.5); // (1+0)/2
    expect(report.avgQueryTimeMs).toBe(20); // (10+20+30)/3
  });

  it("无有效样本时 Recall/MRR 为 0，不除零", () => {
    const report = aggregateReport(
      [mk({ recall: null, reciprocalRank: null, empty: true, elapsedMs: 5 })],
      5,
    );
    expect(report.validCount).toBe(0);
    expect(report.recallAtK).toBe(0);
    expect(report.mrr).toBe(0);
    expect(report.avgQueryTimeMs).toBe(5);
  });
});