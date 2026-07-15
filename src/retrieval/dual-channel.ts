/**
 * retrieval/dual-channel.ts — Dense × FTS5 双通道 RRF 融合
 *
 * 硬约束：双通道融合必须使用 RRF（Reciprocal Rank Fusion，倒数排名融合），
 * 禁止使用加权线性合并（不对分数做归一化后相加）。
 *
 * RRF 公式：
 *   rrfScore(d) = Σ_c  w_c · 1 / (k + rank_c(d))
 * 其中：
 *   - c 遍历命中该文档的每个通道（dense / fts5）；
 *   - rank_c(d) 为文档 d 在通道 c 中的 0 基排名（0 为最相关）；
 *   - k 为平滑常数，取 retrieval.rrfK（默认 60）；
 *   - w_c 为通道权重（denseWeight / ftsWeight，默认 1.0），仅作为对每个
 *     通道贡献项的乘子，不改变 RRF 的“基于排名而非原始分数”的本质，
 *     也不做任何分数归一化。
 *
 * 结果按 rrfScore 降序排列。为保证测试可复现，score 相同时按 nodeId 升序。
 */

/** 融合结果单元（字段为硬约束，不可增删/改名） */
export interface MergedResult {
  /** 节点 id */
  nodeId: number;
  /** 该节点在 dense 通道的 0 基排名；未命中该通道为 null */
  denseRank: number | null;
  /** 该节点在 fts5 通道的 0 基排名；未命中该通道为 null */
  ftsRank: number | null;
  /** RRF 融合分数（越大越相关） */
  rrfScore: number;
  /** 命中通道标识 */
  matchChannel: "dense+fts5" | "dense" | "fts5";
}

/** RRF 融合可调参数 */
export interface RrfOptions {
  /** 平滑常数 k（retrieval.rrfK，默认 60） */
  rrfK?: number;
  /** dense 通道权重（默认 1.0） */
  denseWeight?: number;
  /** fts5 通道权重（默认 1.0） */
  ftsWeight?: number;
  /** 融合后返回上限；不传则返回全部 */
  limit?: number;
}

/** 单个通道的排名输入：nodeId 数组，其下标即 0 基排名 */
export type RankedChannel = readonly number[];

/**
 * 从一个通道的命中数组构建 nodeId → rank 映射。
 * 若同一 nodeId 多次出现，保留其最靠前（最小）的排名。
 */
function toRankMap(ranked: RankedChannel): Map<number, number> {
  const m = new Map<number, number>();
  for (let rank = 0; rank < ranked.length; rank++) {
    const id = ranked[rank];
    if (id === undefined) continue;
    if (!m.has(id)) m.set(id, rank);
  }
  return m;
}

/**
 * RRF 融合 dense 与 fts5 两个通道的排名列表。
 *
 * @param dense dense 通道命中的 nodeId 列表（下标即排名，越靠前越相关）
 * @param fts   fts5 通道命中的 nodeId 列表（同上）
 * @param opts  RRF 参数
 */
export function fuseRrf(
  dense: RankedChannel,
  fts: RankedChannel,
  opts: RrfOptions = {},
): MergedResult[] {
  const k = opts.rrfK ?? 60;
  const denseWeight = opts.denseWeight ?? 1.0;
  const ftsWeight = opts.ftsWeight ?? 1.0;

  const denseRanks = toRankMap(dense);
  const ftsRanks = toRankMap(fts);

  const allIds = new Set<number>([...denseRanks.keys(), ...ftsRanks.keys()]);
  const merged: MergedResult[] = [];

  for (const nodeId of allIds) {
    const dRank = denseRanks.get(nodeId);
    const fRank = ftsRanks.get(nodeId);
    let score = 0;
    if (dRank !== undefined) score += denseWeight * (1 / (k + dRank));
    if (fRank !== undefined) score += ftsWeight * (1 / (k + fRank));

    const inDense = dRank !== undefined;
    const inFts = fRank !== undefined;
    const matchChannel: MergedResult["matchChannel"] =
      inDense && inFts ? "dense+fts5" : inDense ? "dense" : "fts5";

    merged.push({
      nodeId,
      denseRank: dRank ?? null,
      ftsRank: fRank ?? null,
      rrfScore: score,
      matchChannel,
    });
  }

  merged.sort((a, b) =>
    b.rrfScore !== a.rrfScore ? b.rrfScore - a.rrfScore : a.nodeId - b.nodeId,
  );

  return opts.limit !== undefined ? merged.slice(0, opts.limit) : merged;
}