/**
 * retrieval/formatter.ts — 检索结果结构化输出
 *
 * 把 search() 的融合结果与 expandGraph() 的上下文子图组织为：
 * - 结构化 JSON（供程序 / LLM 消费，字段稳定）；
 * - 人类可读文本（供 CLI 打印）。
 *
 * 该模块只做「拼装 + 呈现」，不做检索逻辑，便于单测与复用。
 */
import type { DB } from "../graph/db.js";
import { getNodeById, type NodeRow } from "../graph/nodes.js";
import { getFileById } from "../graph/files.js";
import {
  listResourceEdgesByFile,
  getResourceById,
} from "../graph/resources.js";
import { searchResources } from "./resource-search.js";
import type { SearchResponse, SearchResult } from "./search.js";
import type { ExpandedNode } from "./graph-expand.js";

/** 单条结果的结构化视图 */
export interface FormattedHit {
  nodeId: number;
  name: string;
  kind: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  summary: string | null;
  matchChannel: SearchResult["matchChannel"];
  rrfScore: number;
  denseRank: number | null;
  ftsRank: number | null;
  denseSimilarity: number | null;
}

/** 展开子图的结构化视图 */
export interface FormattedNeighbor {
  nodeId: number;
  name: string;
  kind: string;
  filePath: string | null;
  depth: number;
  isSeed: boolean;
  viaSeeds: number[];
}

/** 关联多模态资源（PRD/DB）的结构化视图 */
export interface FormattedResource {
  resourceId: number;
  type: string;
  name: string;
  summary: string | null;
  sourcePath: string | null;
  /** 边类型：describes（PRD）/ reads（DB） */
  kind: string;
  confidence: number;
  linkType: string;
  /** 关联到的代码文件路径（触达该资源的文件） */
  relatedFilePath: string | null;
}

/** 结构化检索输出 */
export interface FormattedResult {
  query: string;
  hits: FormattedHit[];
  neighbors: FormattedNeighbor[];
  resources: FormattedResource[];
  diagnostics: SearchResponse["diagnostics"];
}

/** 独立资源检索选项（直接搜索 resource_vectors，不依赖 resource_edges） */
export interface DirectResourceOpts {
  queryVec?: readonly number[];
  query: string;
  topK: number;
}

/** 拼装结构化结果 */
export function formatResult(
  db: DB,
  query: string,
  response: SearchResponse,
  neighbors: readonly ExpandedNode[],
  directResourceOpts?: DirectResourceOpts,
): FormattedResult {
  const filePathCache = new Map<number, string | null>();
  const filePathOf = (fileId: number): string | null => {
    if (filePathCache.has(fileId)) return filePathCache.get(fileId) ?? null;
    const f = getFileById(db, fileId);
    const p = f?.file_path ?? null;
    filePathCache.set(fileId, p);
    return p;
  };

  // 收集 hits + neighbors 涉及的所有节点的 file_id（去重），用于展开关联资源。
  const fileIds = new Set<number>();

  const hits: FormattedHit[] = response.results.map((r) => {
    const node = getNodeById(db, r.nodeId);
    if (node) fileIds.add(node.file_id);
    return {
      nodeId: r.nodeId,
      name: node?.name ?? `#${r.nodeId}`,
      kind: node?.kind ?? "unknown",
      filePath: node ? filePathOf(node.file_id) : null,
      startLine: node?.start_line ?? null,
      endLine: node?.end_line ?? null,
      summary: node?.summary ?? null,
      matchChannel: r.matchChannel,
      rrfScore: r.rrfScore,
      denseRank: r.denseRank,
      ftsRank: r.ftsRank,
      denseSimilarity: r.denseSimilarity,
    };
  });

  const formattedNeighbors: FormattedNeighbor[] = neighbors.map((n) => {
    fileIds.add(n.node.file_id);
    return {
      nodeId: n.node.id,
      name: n.node.name,
      kind: n.node.kind,
      filePath: filePathOf(n.node.file_id),
      depth: n.depth,
      isSeed: n.isSeed,
      viaSeeds: n.viaSeeds,
    };
  });

  // 展开关联的多模态资源边（PRD/DB）：遍历去重后的 fileId 集合，
  // 按 (resourceId, kind) 去重、confidence 降序组装。
  const resources = collectResources(db, fileIds, filePathOf);

  // 独立资源检索：直接搜索 resource_vectors + LIKE，召回无 resource_edges 关联的资源。
  if (directResourceOpts) {
    const existingIds = new Set(resources.map((r) => r.resourceId));
    const directHits = searchResources(
      db,
      directResourceOpts.queryVec ?? null,
      directResourceOpts.query,
      directResourceOpts.topK,
    );
    for (const hit of directHits) {
      if (existingIds.has(hit.resourceId)) continue;
      const resource = getResourceById(db, hit.resourceId);
      if (resource === undefined) continue;
      existingIds.add(hit.resourceId);
      resources.push({
        resourceId: resource.id,
        type: resource.type,
        name: resource.name,
        summary: resource.summary,
        sourcePath: resource.source_path,
        kind: "direct",
        confidence: hit.similarity ?? 0.5,
        linkType: "direct",
        relatedFilePath: null,
      });
    }
  }

  return {
    query,
    hits,
    neighbors: formattedNeighbors,
    resources,
    diagnostics: response.diagnostics,
  };
}

/**
 * 收集给定文件集合关联的多模态资源，按 (resourceId, kind) 去重，
 * confidence 降序返回。
 */
export function collectResources(
  db: DB,
  fileIds: Iterable<number>,
  filePathOf: (fileId: number) => string | null,
): FormattedResource[] {
  /** key = `${resourceId}:${kind}` → 已收集的资源视图 */
  const seen = new Map<string, FormattedResource>();

  for (const fileId of fileIds) {
    const edges = listResourceEdgesByFile(db, fileId);
    for (const edge of edges) {
      const key = `${edge.resource_id}:${edge.kind}`;
      const prev = seen.get(key);
      // 同一 (resource, kind) 保留 confidence 更高的那条边。
      if (prev !== undefined && prev.confidence >= edge.confidence) continue;
      const resource = getResourceById(db, edge.resource_id);
      if (resource === undefined) continue;
      seen.set(key, {
        resourceId: resource.id,
        type: resource.type,
        name: resource.name,
        summary: resource.summary,
        sourcePath: resource.source_path,
        kind: edge.kind,
        confidence: edge.confidence,
        linkType: edge.link_type,
        relatedFilePath: filePathOf(fileId),
      });
    }
  }

  return [...seen.values()].sort((a, b) => b.confidence - a.confidence);
}

/** 位置字符串：path:start-end */
function locationOf(hit: FormattedHit | FormattedNeighbor): string {
  const path = hit.filePath ?? "<unknown>";
  if ("startLine" in hit && hit.startLine != null) {
    const end = hit.endLine != null ? `-${hit.endLine}` : "";
    return `${path}:${hit.startLine}${end}`;
  }
  return path;
}

/** 渲染为人类可读文本（供 CLI 打印） */
export function renderText(result: FormattedResult): string {
  const lines: string[] = [];
  lines.push(`查询：${result.query}`);

  if (result.hits.length === 0) {
    lines.push("未找到匹配结果。");
  } else {
    lines.push(`\n命中 ${result.hits.length} 个节点：`);
    result.hits.forEach((h, i) => {
      lines.push(
        `${i + 1}. [${h.kind}] ${h.name}  (${locationOf(h)})  ` +
          `channel=${h.matchChannel} rrf=${h.rrfScore.toFixed(5)}` +
          (h.denseSimilarity != null
            ? ` sim=${h.denseSimilarity.toFixed(3)}`
            : ""),
      );
      if (h.summary) lines.push(`   ${h.summary}`);
    });
  }

  const nonSeed = result.neighbors.filter((n) => !n.isSeed);
  if (nonSeed.length > 0) {
    lines.push(`\n相关上下文（图谱展开 ${nonSeed.length} 个邻居）：`);
    nonSeed.forEach((n) => {
      lines.push(
        `  · [${n.kind}] ${n.name}  (${locationOf(n)})  depth=${n.depth}`,
      );
    });
  }

  if (result.resources.length > 0) {
    lines.push(`\n关联资源（PRD/DB ${result.resources.length} 条）：`);
    result.resources.forEach((r) => {
      lines.push(
        `  · [${r.type}] ${r.name}  (confidence=${r.confidence.toFixed(3)} ${r.linkType})`,
      );
      if (r.summary) lines.push(`    ${r.summary}`);
    });
  }

  if (result.diagnostics.fallbackTriggered) {
    lines.push("\n（提示：Dense 相似度偏低，已触发全量向量兜底检索）");
  }

  return lines.join("\n");
}

/** 渲染为 JSON 字符串 */
export function renderJson(result: FormattedResult): string {
  return JSON.stringify(result, null, 2);
}

/** NodeRow 便捷再导出（供上层类型引用） */
export type { NodeRow };