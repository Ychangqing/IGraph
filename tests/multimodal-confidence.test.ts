/**
 * multimodal-confidence.test.ts — 置信度分级纯函数（M7）
 *
 * 覆盖三档判定：strong / weak / 不建边，及 confidence 数值与裁剪。
 */
import { describe, it, expect } from "vitest";
import {
  gradeConfidence,
  WEAK_CONFIDENCE_FACTOR,
  type ConfidenceThresholds,
} from "../src/multimodal/confidence.js";

const THRESHOLDS: ConfidenceThresholds = {
  strongLinkThreshold: 0.85,
  weakLinkThreshold: 0.7,
};

describe("gradeConfidence", () => {
  it("相似度 >= strong 阈值 → strong，confidence 取 similarity", () => {
    const g = gradeConfidence(0.9, THRESHOLDS);
    expect(g.shouldLink).toBe(true);
    expect(g.linkType).toBe("strong");
    expect(g.confidence).toBeCloseTo(0.9, 10);
    expect(g.similarity).toBe(0.9);
  });

  it("恰好等于 strong 阈值 → strong（含边界）", () => {
    const g = gradeConfidence(0.85, THRESHOLDS);
    expect(g.linkType).toBe("strong");
    expect(g.shouldLink).toBe(true);
  });

  it("weak <= 相似度 < strong → weak，confidence = similarity * 折扣", () => {
    const g = gradeConfidence(0.8, THRESHOLDS);
    expect(g.shouldLink).toBe(true);
    expect(g.linkType).toBe("weak");
    expect(g.confidence).toBeCloseTo(0.8 * WEAK_CONFIDENCE_FACTOR, 10);
  });

  it("恰好等于 weak 阈值 → weak（含边界）", () => {
    const g = gradeConfidence(0.7, THRESHOLDS);
    expect(g.linkType).toBe("weak");
    expect(g.shouldLink).toBe(true);
  });

  it("相似度 < weak 阈值 → 不建边", () => {
    const g = gradeConfidence(0.5, THRESHOLDS);
    expect(g.shouldLink).toBe(false);
    expect(g.confidence).toBe(0);
  });

  it("strong 段 confidence 裁剪到 [0,1]（相似度 > 1 时）", () => {
    const g = gradeConfidence(1.5, THRESHOLDS);
    expect(g.linkType).toBe("strong");
    expect(g.confidence).toBe(1);
  });

  it("weak 段负相似度不会出现（低于 weak 直接不建边）", () => {
    const g = gradeConfidence(-0.2, THRESHOLDS);
    expect(g.shouldLink).toBe(false);
  });
});