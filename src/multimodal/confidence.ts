/**
 * multimodal/confidence.ts — 资源↔文件相似度的置信度分级（M7）
 *
 * 依据 multimodal 配置的两个阈值把一次向量相似度中分为三档：
 *   - similarity >= strongLinkThreshold → strong link（高置信关联）；
 *   - weakLinkThreshold <= similarity < strongLinkThreshold → weak link
 *     （弱关联，可选由 LLM 二次确认，MVP 不确认直接建边）；
 *   - similarity < weakLinkThreshold → 不建边（丢弃）。
 *
 * confidence 数值：strong 直接取 similarity（已足够高）；weak 取 similarity
 *   打折（乘以 weak 系数）以在展示 / 排序时区分强弱。分级纯函数，便于单测。
 */

/** 分级判定用到的阈值（取自 MultimodalConfig 子集） */
export interface ConfidenceThresholds {
  /** strong link 阈值（默认 0.85） */
  strongLinkThreshold: number;
  /** weak link 阈值（默认 0.70） */
  weakLinkThreshold: number;
}

/** 链接强度 */
export type LinkType = "strong" | "weak";

/** 分级结果 */
export interface ConfidenceGrade {
  /** 是否应建边（相似度低于 weak 阈值时为 false） */
  shouldLink: boolean;
  /** 链接强度（shouldLink=false 时无意义，置 "weak"） */
  linkType: LinkType;
  /** 落库置信度分值（0~1） */
  confidence: number;
  /** 原始相似度（透传） */
  similarity: number;
}

/** weak link 的置信度折扣系数：weak 边的 confidence = similarity * WEAK_FACTOR */
export const WEAK_CONFIDENCE_FACTOR = 0.8;

/**
 * 对单次相似度做置信度分级。
 *
 * @param similarity 向量余弦相似度（约 [-1, 1]，正常命中为 [0, 1]）
 * @param thresholds strong / weak 阈值
 */
export function gradeConfidence(
  similarity: number,
  thresholds: ConfidenceThresholds,
): ConfidenceGrade {
  const { strongLinkThreshold, weakLinkThreshold } = thresholds;

  if (similarity >= strongLinkThreshold) {
    return {
      shouldLink: true,
      linkType: "strong",
      confidence: clamp01(similarity),
      similarity,
    };
  }

  if (similarity >= weakLinkThreshold) {
    return {
      shouldLink: true,
      linkType: "weak",
      confidence: clamp01(similarity * WEAK_CONFIDENCE_FACTOR),
      similarity,
    };
  }

  return {
    shouldLink: false,
    linkType: "weak",
    confidence: 0,
    similarity,
  };
}

/** 将数值裁剪到 [0, 1] */
function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}