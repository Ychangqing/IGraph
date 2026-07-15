/**
 * multimodal/index.ts — 多模态挂载主流程（M7）
 *
 * 对外提供 mountPrd / mountDb 两个入口，串起：
 *   解析（parser）→ 切分（chunker/parseDdl）→ 落库 resources
 *   → 向量化切片 summary → upsert resource_vectors
 *   → linker 在 file_vectors 上匹配建 resource_edges。
 *
 * 优雅降级（对齐 query/build）：
 *   - 无 API Key（credentials.apiKey 为空）：只解析并落库 resources，跳过
 *     向量化与建边，返回 embedded=false 与降级原因，不报错退出。
 *   - file_vectors 为空（未 build 或 --no-llm）：向量化 resources 后无可匹配
 *     的文件向量，建边为 0，返回相应 note。
 *
 * 重复挂载：先按 source_path 删除旧 resources（级联删除其边），再重新写入，
 *   保证幂等。resource_vectors 由 upsert 覆盖，遗留向量不影响（其 resource_id
 *   已随 resources 删除而失去引用）。
 */
import { createHash } from "node:crypto";

import { logger } from "../utils/logger.js";
import type { ResolvedConfig } from "../config/index.js";
import type { DB } from "../graph/db.js";
import type { ResourceInput, ResourceType } from "../graph/resources.js";
import {
  countResourceEdges,
  deleteResourceEdgesByFile,
  deleteResourcesBySource,
  insertResources,
  listResources,
} from "../graph/resources.js";
import { EmbeddingClient } from "../vector/index.js";
import { countVectors, getVector, upsertVectors } from "../vector/store.js";
import type { ConfidenceThresholds } from "./confidence.js";
import { parseDbSchema } from "./db-schema/parser.js";
import { linkResources, linkResourcesWithin, type LinkableResource } from "./linker.js";
import { parsePrd } from "./prd/parser.js";
import type { ParseResult } from "./types.js";

/** 挂载结果统计 */
export interface MountResult {
  /** 资源类型 */
  type: ResourceType;
  /** 来源文件路径 */
  sourcePath: string;
  /** 解析并落库的切片数 */
  resources: number;
  /** 是否完成了向量化 */
  embedded: boolean;
  /** 新建的关联边数 */
  edges: number;
  /** strong 边数 */
  strong: number;
  /** weak 边数 */
  weak: number;
  /** 降级 / 提示信息（无则 undefined） */
  note?: string;
}

/** 挂载可选项 */
export interface MountOptions {
  /** 每个切片检索的候选文件数上限（默认取 retrieval.fileTopK） */
  topK?: number;
}

/** 挂载 PRD 文档：切片 kind = describes */
export async function mountPrd(
  db: DB,
  config: ResolvedConfig,
  sourcePath: string,
  options: MountOptions = {},
): Promise<MountResult> {
  const parsed = await parsePrd(sourcePath);
  return mount(db, config, sourcePath, "prd", "describes", parsed, options);
}

/** 挂载 DB Schema：切片 kind = reads */
export async function mountDb(
  db: DB,
  config: ResolvedConfig,
  sourcePath: string,
  options: MountOptions = {},
): Promise<MountResult> {
  const parsed = await parseDbSchema(sourcePath);
  return mount(db, config, sourcePath, "db", "reads", parsed, options);
}

/**
 * 挂载主流程（PRD/DB 共用）。
 */
async function mount(
  db: DB,
  config: ResolvedConfig,
  sourcePath: string,
  type: ResourceType,
  kind: "describes" | "reads",
  parsed: ParseResult,
  options: MountOptions,
): Promise<MountResult> {
  const { chunks } = parsed;

  // 无切片：直接返回（可能是空文档）。
  if (chunks.length === 0) {
    return {
      type,
      sourcePath,
      resources: 0,
      embedded: false,
      edges: 0,
      strong: 0,
      weak: 0,
      note: "未从文件解析出任何切片（文件可能为空或无可识别结构）",
    };
  }

  // 重复挂载：清理同来源旧数据（级联删边），保证幂等。
  const removed = deleteResourcesBySource(db, sourcePath);
  if (removed > 0) {
    logger.info(`清理旧资源 ${removed} 条（来源：${sourcePath}）`);
  }

  // 落库 resources（携带内容哈希，便于后续增量比对）。
  const inputs: ResourceInput[] = chunks.map((c) => ({
    type,
    sourcePath,
    name: c.name,
    content: c.content,
    summary: c.summary,
    hash: sha256(c.content),
  }));
  const resourceIds = insertResources(db, inputs);

  // ── 降级探测：无 API Key 则只落库，不向量化 / 建边 ──
  const hasApiKey = config.credentials.apiKey.trim() !== "";
  if (!hasApiKey) {
    return {
      type,
      sourcePath,
      resources: resourceIds.length,
      embedded: false,
      edges: 0,
      strong: 0,
      weak: 0,
      note: "未配置 IGRAPH_API_KEY，已仅落库资源切片，跳过向量化与关联建边",
    };
  }

  // 向量化切片 summary。
  const client = new EmbeddingClient({
    baseURL: config.credentials.embeddingBaseURL ?? config.embedding.baseURL,
    model: config.embedding.model,
    apiKey: config.credentials.apiKey,
    dimensions: config.embedding.dimensions,
    batchSize: config.embedding.batchSize,
  });
  const vectors = await client.embed(chunks.map((c) => c.summary));

  // upsert resource_vectors（复用 store 的 BigInt 主键封装）。
  const vectorEntries = resourceIds.map((id, i) => ({
    id,
    vector: vectors[i] ?? [],
  }));
  upsertVectors(db, "resource_vectors", vectorEntries);

  // ── 若无文件向量，则无从匹配，跳过建边 ──
  const hasFileVectors = countVectors(db, "file_vectors") > 0;
  if (!hasFileVectors) {
    return {
      type,
      sourcePath,
      resources: resourceIds.length,
      embedded: true,
      edges: 0,
      strong: 0,
      weak: 0,
      note: "file_vectors 为空（可能未构建或以 --no-llm 构建），已向量化资源但无可匹配文件，未建边",
    };
  }

  // 建边：切片向量 vs file_vectors Top-K，置信度分级后写 resource_edges。
  const thresholds: ConfidenceThresholds = {
    strongLinkThreshold: config.multimodal.strongLinkThreshold,
    weakLinkThreshold: config.multimodal.weakLinkThreshold,
  };
  const topK = options.topK && options.topK > 0 ? options.topK : config.retrieval.fileTopK;
  const linkables: LinkableResource[] = resourceIds.map((id, i) => ({
    resourceId: id,
    vector: vectors[i] ?? [],
  }));
  const linkResult = linkResources(db, linkables, { kind, topK, thresholds });

  logger.info(`当前资源边总数：${countResourceEdges(db)}`);

  return {
    type,
    sourcePath,
    resources: resourceIds.length,
    embedded: true,
    edges: linkResult.edges,
    strong: linkResult.strong,
    weak: linkResult.weak,
  };
}

/** 增量刷新结果统计 */
export interface RefreshEdgesResult {
  /** 参与重连的资源切片数（有向量的） */
  refreshed: number;
  /** 因缺向量而跳过的资源切片数 */
  skipped: number;
  /** 新建的关联边数 */
  edges: number;
  /** strong 边数 */
  strong: number;
  /** weak 边数 */
  weak: number;
  /** 降级 / 提示信息（无则 undefined） */
  note?: string;
}

/** resources.type → resource_edges.kind 映射 */
function edgeKindOf(type: string): "describes" | "reads" {
  return type === "db" ? "reads" : "describes";
}

/**
 * 增量刷新多模态关联边（M8）。
 *
 * 当代码文件发生新增/修改/删除后，指向这些文件的 resource_edges 可能失效，
 * 且新文件也可能匹配到已有资源切片。本函数复用 resource_vectors 中已存的
 * 切片向量（getVector 读回，零 API 成本），只对受影响文件做定向匹配建边。
 *
 * 处理策略：
 *   - affectedFileIds 提供且非空时：先清理其旧边，再用 linkResourcesWithin
 *     只在这些文件范围内匹配，其余文件的已有边保持不变。
 *   - affectedFileIds 为空时：对全量 file_vectors 做 KNN 匹配（首次挂载场景）。
 *   - 缺向量的资源（未向量化 / --no-llm 挂载）跳过。
 *   - file_vectors 为空则无从匹配，直接返回。
 */
export function refreshMultimodalEdges(
  db: DB,
  config: ResolvedConfig,
  affectedFileIds: number[] = [],
): RefreshEdgesResult {
  const resources = listResources(db);
  if (resources.length === 0) {
    return { refreshed: 0, skipped: 0, edges: 0, strong: 0, weak: 0, note: "无已挂载资源，跳过多模态边刷新" };
  }

  if (countVectors(db, "file_vectors") === 0) {
    return {
      refreshed: 0,
      skipped: 0,
      edges: 0,
      strong: 0,
      weak: 0,
      note: "file_vectors 为空（未构建或以 --no-llm 构建），无可匹配文件，跳过多模态边刷新",
    };
  }

  for (const fileId of affectedFileIds) {
    deleteResourceEdgesByFile(db, fileId);
  }

  const thresholds: ConfidenceThresholds = {
    strongLinkThreshold: config.multimodal.strongLinkThreshold,
    weakLinkThreshold: config.multimodal.weakLinkThreshold,
  };
  const topK = config.retrieval.fileTopK;
  const useTargeted = affectedFileIds.length > 0;

  const byKind = new Map<"describes" | "reads", LinkableResource[]>();
  let skipped = 0;
  for (const res of resources) {
    const vector = getVector(db, "resource_vectors", res.id);
    if (!vector || vector.length === 0) {
      skipped += 1;
      continue;
    }
    const kind = edgeKindOf(res.type);
    const list = byKind.get(kind) ?? [];
    list.push({ resourceId: res.id, vector });
    byKind.set(kind, list);
  }

  let edges = 0;
  let strong = 0;
  let weak = 0;
  let refreshed = 0;
  for (const [kind, linkables] of byKind) {
    if (linkables.length === 0) {
      continue;
    }
    const result = useTargeted
      ? linkResourcesWithin(db, linkables, affectedFileIds, { kind, topK, thresholds })
      : linkResources(db, linkables, { kind, topK, thresholds });
    edges += result.edges;
    strong += result.strong;
    weak += result.weak;
    refreshed += linkables.length;
  }

  logger.info(`多模态边刷新完成，当前资源边总数：${countResourceEdges(db)}`);

  return { refreshed, skipped, edges, strong, weak };
}

/** 计算内容 sha256 十六进制摘要 */
function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}