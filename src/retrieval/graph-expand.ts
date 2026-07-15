/**
 * retrieval/graph-expand.ts — 检索命中节点的图谱 N 跳展开
 *
 * 在双通道融合得到种子节点后，沿调用关系图对每个种子做 N 跳邻居展开
 * （复用 graph/traverse 的递归 CTE），把「命中节点 + 其上下游」组织成
 * 一个可供 LLM / 用户消费的上下文子图。
 *
 * 设计：
 * - 展开方向默 "both"（同时取 callers 与 callees），跳数取 retrieval.graphHops。
 * - 一个节点可能被多个种子展开命中，保留其到「最近种子」的最短跳数。
 * - 展开结果标注来源：是种子本身还是被展开的邻居。
 */
import type { DB } from "../graph/db.js";
import { getNodeById, type NodeRow } from "../graph/nodes.js";
import { traverse, type TraverseDirection } from "../graph/traverse.js";

/** 展开后的一个节点条目 */
export interface ExpandedNode {
  /** 节点行 */
  node: NodeRow;
  /** 到最近种子的跳数（种子自身为 0） */
  depth: number;
  /** 是否为检索命中的种子节点 */
  isSeed: boolean;
  /** 触达该节点的种子 id 列表 */
  viaSeeds: number[];
}

/** 图展开选项 */
export interface ExpandOptions {
  /** 最大跳数（retrieval.graphHops，默认 2） */
  maxHops?: number;
  /** 展开方向，默认 "both" */
 direction?: TraverseDirection;
}

/**
 * 对一组种子节点做图谱展开。
 *
 * @param db      数据库
 * @param seedIds 检索命中的种子节点 id（按相关性排序）
 * @param options 跳数 / 方向
 * @returns 去重后的展开节点列表，按 (depth 升序, nodeId 升序) 排列
 */
export function expandGraph(
  db: DB,
  seedIds: readonly number[],
  options: ExpandOptions = {},
): ExpandedNode[] {
  const maxHops = options.maxHops ?? 2;
  const direction: TraverseDirection = options.direction ?? "both";

  /** nodeId → 聚合条目 */
  const acc = new Map<
    number,
    { node: NodeRow; depth: number; isSeed: boolean; viaSeeds: Set<number> }
  >();

  const upsert = (
    node: NodeRow,
    depth: number,
    isSeed: boolean,
    seedId: number,
  ): void => {
    const prev = acc.get(node.id);
    if (prev === undefined) {
      acc.set(node.id, {
        node,
        depth,
        isSeed,
        viaSeeds: new Set([seedId]),
      });
      return;
    }
    prev.depth = Math.min(prev.depth, depth);
    prev.isSeed = prev.isSeed || isSeed;
    prev.viaSeeds.add(seedId);
  };

  for (const seedId of seedIds) {
    const seedNode = getNodeById(db, seedId);
    if (seedNode === undefined) continue;
    // 种子自身（depth 0）。
    upsert(seedNode, 0, true, seedId);
    // 邻居展开（不含起点，起点已单独加入）。
    if (maxHops > 0) {
      const hits = traverse(db, {
        startId: seedId,
        direction,
        maxHops,
        includeStart: false,
      });
      for (const hit of hits) {
        upsert(hit.node, hit.depth, false, seedId);
      }
    }
  }

  return [...acc.values()]
    .map((e) => ({
      node: e.node,
      depth: e.depth,
      isSeed: e.isSeed,
      viaSeeds: [...e.viaSeeds].sort((a, b) => a - b),
    }))
    .sort((a, b) => (a.depth !== b.depth ? a.depth - b.depth : a.node.id - b.node.id));
}