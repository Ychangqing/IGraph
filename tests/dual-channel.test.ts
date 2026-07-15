/**
 * dual-channel.test.ts — RRF 融合核心（纯函数）
 *
 * 覆盖：
 * - 严格 RRF 公式 score = Σ w/(k+rank)，禁止加权线性合并；
 * - matchChannel 由命中通道决定（dense+fts5 / dense / fts5）；
 * - 排序确定性：rrfScore 降序，同分按 nodeId 升序；
 * - limit 截断。
 */
import { describe, it, expect } from "vitest";
import { fuseRrf } from "../src/retrieval/dual-channel.js";

describe("fuseRrf - RRF 融合", () => {
  it("同时命中两通道的节点 matchChannel 为 dense+fts5，且分数为两项之和", () => {
    // dense: [10, 20]（rank 0,1）；fts: [20, 10]（rank 0,1）
    const merged = fuseRrf([10, 20], [20, 10], { rrfK: 60 });
    const m10 = merged.find((r) => r.nodeId === 10);
    const m20 = merged.find((r) => r.nodeId === 20);
    expect(m10?.matchChannel).toBe("dense+fts5");
    expect(m20?.matchChannel).toBe("dense+fts5");
    // 10: dense rank0 + fts rank1 = 1/60 + 1/61
    expect(m10?.rrfScore).toBeCloseTo(1 / 60 + 1 / 61, 10);
    // 两者对称，分数相等
    expect(m10?.rrfScore).toBeCloseTo(m20?.rrfScore ?? -1, 10);
    expect(m10?.denseRank).toBe(0);
    expect(m10?.ftsRank).toBe(1);
  });

  it("仅命中单通道时 matchChannel 与 rank 正确", () => {
    const merged = fuseRrf([1], [2], { rrfK: 60 });
    const a = merged.find((r) => r.nodeId === 1);
    const b = merged.find((r) => r.nodeId === 2);
    expect(a?.matchChannel).toBe("dense");
    expect(a?.ftsRank).toBeNull();
    expect(b?.matchChannel).toBe("fts5");
    expect(b?.denseRank).toBeNull();
  });

  it("按 rrfScore 降序排列，rank 越靠前分数越高", () => {
    const merged = fuseRrf([1, 2, 3], [], { rrfK: 60 });
    expect(merged.map((r) => r.nodeId)).toEqual([1, 2, 3]);
    expect(merged[0]!.rrfScore).toBeGreaterThan(merged[1]!.rrfScore);
  });

  it("同分时按 nodeId 升序（确定性）", () => {
    // 仅 dense，rank 相同不可能；构造两节点各自单通道且 rank 相同
    // dense rank0 = node 5；fts rank0 = node 3 → 两者同分 1/60
    const merged = fuseRrf([5], [3], { rrfK: 60 });
    expect(merged[0]!.rrfScore).toBeCloseTo(merged[1]!.rrfScore, 10);
    // 同分 → nodeId 升序 → 3 在
    expect(merged.map((r) => r.nodeId)).toEqual([3, 5]);
  });

  it("limit 截断结果条数", () => {
    const merged = fuseRrf([1, 2, 3, 4], [], { rrfK: 60, limit: 2 });
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.nodeId)).toEqual([1, 2]);
  });

  it("权重影响各通道贡献（denseWeight 提升 dense 项）", () => {
    const base = fuseRrf([1], [], { rrfK: 60, denseWeight: 1 });
    const boosted = fuseRrf([1], [], { rrfK: 60, denseWeight: 2 });
    expect(boosted[0]!.rrfScore).toBeCloseTo(2 * base[0]!.rrfScore, 10);
  });

  it("空输入返回空数组", () => {
    expect(fuseRrf([], [], { rrfK: 60 })).toEqual([]);
  });
});