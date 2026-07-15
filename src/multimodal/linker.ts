/**
 * multimodal/linker.ts — 资源切片 ↔ 代码文件的关联建边（M7）
 *
 * 输入：已向量化并落库的资源切片（resource_id + 其 summary 向量）。
 * 过程：以切片向量在 file_vectors 上做 Top-K KNN，对每条命中调用
 *   gradeConfidence 分级；相似度达到 weak 阈值以上者写入 resource_edges，
 *   携带 similarity / confidence / link_type。
 *
 * 说明：不做向量化 / embedding（由 index.ts 完成），仅消费已有向量表与切片
 *   向量做匹配建边。纯粹依赖 vector/store.ts 与 graph/resources.ts 封装，
 *   不直接触碰 vec0 主键（BigInt 处理已在 store 内）。
 */
import type { DB } from "../graph/db.js";
import type {
  ResourceEdgeInput,
  ResourceEdgeKind,
} from "../graph/resources.js";
import { upsertResourceEdges } from "../graph/resources.js";
import { searchVectors, searchVectorsWithin } from "../vector/store.js";
import type { ConfidenceThresholds } from "./confidence.js";
import { gradeConfidence } from "./confidence.js";

/** 单个待建边的资源切片（已落库、已知其向量） */
export interface LinkableResource {
  /** resources 表主键 */
  resourceId: number;
  /** 该切片的向量（其 summary 的 embedding） */
  vector: number[];
}

/** 建边参数 */
export interface LinkOptions {
  /** 边类型：PRD→describes，DB→reads */
  kind: ResourceEdgeKind;
  /** 每个切片检索的候选文件数上限 */
  topK: number;
  /** 置信度分级阈值 */
  thresholds: ConfidenceThresholds;
}

/** 建边统计 */
export interface LinkResult {
  /** 成功建立的边数 */
  edges: number;
  /** strong 边数 */
  strong: number;
  /** weak 边数 */
  weak: number;
}

/**
 * 为一批资源切片建立到代码文件的关联边。
 *
 * @param db 数据库连接
 * @param resources 已落库并已知向量的切片列表
 * @param options 边类型 / topK / 阈值
 */
export function linkResources(
  db: DB,
  resources: readonly LinkableResource[],
  options: LinkOptions,
): LinkResult {
  const { kind, topK, thresholds } = options;
  const edgeInputs: ResourceEdgeInput[] = [];
  let strong = 0;
  let weak = 0;

  for (const resource of resources) {
    const hits = searchVectors(db, "file_vectors", resource.vector, topK);
    for (const hit of hits) {
      const grade = gradeConfidence(hit.similarity, thresholds);
      if (!grade.shouldLink) continue;
      edgeInputs.push({
        resourceId: resource.resourceId,
        fileId: hit.id,
        kind,
        similarity: grade.similarity,
        confidence: grade.confidence,
        linkType: grade.linkType,
      });
      if (grade.linkType === "strong") strong++;
      else weak++;
    }
  }

  if (edgeInputs.length > 0) {
    upsertResourceEdges(db, edgeInputs);
  }

  return { edges: edgeInputs.length, strong, weak };
}

/**
 * 定向版 linkResources：只在指定 fileIds 范围内匹配，用于增量刷新时
 * 避免全表 KNN。已有的其他文件的边不受影响。
 */
export function linkResourcesWithin(
  db: DB,
  resources: readonly LinkableResource[],
  fileIds: readonly number[],
  options: LinkOptions,
): LinkResult {
  const { kind, topK, thresholds } = options;
  const edgeInputs: ResourceEdgeInput[] = [];
  let strong = 0;
  let weak = 0;

  for (const resource of resources) {
    const hits = searchVectorsWithin(db, "file_vectors", resource.vector, fileIds, topK);
    for (const hit of hits) {
      const grade = gradeConfidence(hit.similarity, thresholds);
      if (!grade.shouldLink) continue;
      edgeInputs.push({
        resourceId: resource.resourceId,
        fileId: hit.id,
        kind,
        similarity: grade.similarity,
        confidence: grade.confidence,
        linkType: grade.linkType,
      });
      if (grade.linkType === "strong") strong++;
      else weak++;
    }
  }

  if (edgeInputs.length > 0) {
    upsertResourceEdges(db, edgeInputs);
  }

  return { edges: edgeInputs.length, strong, weak };
}