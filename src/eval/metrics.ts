/**
 * eval/metrics.ts — 检索质量指标计算（Recall@K / MRR / 平均耗时）
 *
 * 对应工程规划「评测先行」原则的 MVP 指标层。指标定义：
 *
 * - Recall@K：对每条 query，命中集合 = Top-K 结果里落在 expected 中的项；
 *   单条 recall = |命中 ∩ expected| / |expected|，再对所有 query 求平均。
 * - MRR（Mean Reciprocal Rank）：对每条 query，取第一个命中 expected 的 1 基
 *   排名 r，RR = 1/r（无命中记 0），再对所有 query 求平均。
 * - Avg Query Time：每条 query 的检索耗时（毫秒）平均值。
 *
 * 命中判定基于「符号名」集合（expected_nodes）。expected 为空的 query 视为
 * 无效样本，不参与 Recall / MRR 的分母（避免除零污染均值），但仍记录耗时。
 *
 * 该模块为纯函数，不触碰 DB / 网络，便于单测与复用。
 */

/** 单条评测样本（对应 queries.json 的一条记录，MVP 忽略 prd/tables） */
export interface EvalCase {
  /** 自然语言查询 */
  query: string;
  /** 期望命中的符号名（真实存在的 node.name） */
  expected_nodes: string[];
  /** 期望命中的文件路径（可选，MVP 主指标基于 nodes） */
  expected_files?: string[];
}

/** 一次检索返回给评测层的排名结果（按相关性降序，rank0 最相关） */
export interface RankedResult {
  /** 命中节点名 */
  name: string;
  /** 命中节点所在文件路径（可空） */
  filePath: string | null;
}

/** 单条 query 的评测明细 */
export interface CaseMetric {
  query: string;
  /** 该 query 的 Recall@K；expected 为空时为 null（不适用，不计入均值） */
  recall: number | null;
  /** 该 query 的 Reciprocal Rank（首个命中的 1/r，无命中为 0）；expected 为空时为 null */
  reciprocalRank: number | null;
  /** 首个命中的 1 基排名（无命中为 null） */
  firstHitRank: number | null;
  /** 检索耗时（毫秒） */
  elapsedMs: number;
  /** expected_nodes 是否为空（空样本不计入均值分母） */
  empty: boolean;
}

/** 聚合评测报告 */
export interface EvalReport {
  /** K 值（Recall@K 的 K） */
  k: number;
  /** 有效样本数（expected_nodes 非空） */
  validCount: number;
  /** 总样本数 */
  totalCount: number;
  /** 平均 Recall@K（仅对有效样本） */
  recallAtK: number;
  /** 平均 MRR（仅对有效样本） */
  mrr: number;
  /** 平均检索耗时（毫秒，对全部样本） */
  avgQueryTimeMs: number;
  /** 每条 query 的明细 */
  cases: CaseMetric[];
}

/** 归一化名称用于比较（去空白，大小写不敏感） */
function normName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * 计算单条 query 的 Recall@K 与 Reciprocal Rank。
 *
 * @param results  检索结果（已按相关性降序）
 * @param expected 期望命中的符号名
 * @param k        Recall@K 的 K；取结果前 k 条参与命中判定
 * @returns expected 为空时 recall / reciprocalRank 为 null（不适用，聚合时跳过），
 *          以区分「有期望但零召回（0）」与「无期望（N/A）」。
 */
export function evaluateCase(
  results: readonly RankedResult[],
  expected: readonly string[],
  k: number,
): { recall: number | null; reciprocalRank: number | null; firstHitRank: number | null } {
  const expectedSet = new Set(expected.map(normName));
  if (expectedSet.size === 0) {
    return { recall: null, reciprocalRank: null, firstHitRank: null };
  }

  const topK = results.slice(0, k);

  // Recall@K：Top-K 中命中的 expected 项去重占比。
  const hitExpected = new Set<string>();
  for (const r of topK) {
    const nm = normName(r.name);
    if (expectedSet.has(nm)) hitExpected.add(nm);
  }
  const recall = hitExpected.size / expectedSet.size;

  // MRR：全量结果中首个命中的 1 基排名（不受 K 截断，更能反映排序质量）。
  let firstHitRank: number | null = null;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r && expectedSet.has(normName(r.name))) {
      firstHitRank = i + 1;
      break;
    }
  }
  const reciprocalRank = firstHitRank === null ? 0 : 1 / firstHitRank;

  return { recall, reciprocalRank, firstHitRank };
}

/**
 * 聚合每条 query 的明细为整体报告。
 *
 * @param cases 每条 query 的评测明细（含 empty 标记与耗时）
 * @param k     Recall@K 的 K
 */
export function aggregateReport(cases: readonly CaseMetric[], k: number): EvalReport {
  const totalCount = cases.length;
  // 有效样本：recall 非 null（expected 非空）。null 表示「不适用」，跳过分母。
  const valid = cases.filter((c) => c.recall !== null);
  const validCount = valid.length;

  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

  const recallAtK =
    validCount === 0 ? 0 : sum(valid.map((c) => c.recall ?? 0)) / validCount;
  const mrr =
    validCount === 0 ? 0 : sum(valid.map((c) => c.reciprocalRank ?? 0)) / validCount;
  const avgQueryTimeMs =
    totalCount === 0 ? 0 : sum(cases.map((c) => c.elapsedMs)) / totalCount;

  return {
    k,
    validCount,
    totalCount,
    recallAtK,
    mrr,
    avgQueryTimeMs,
    cases: [...cases],
  };
}