/**
 * semantic/fallback.ts — 无 LLM 降级模式（启发式摘要）
 *
 * 对应规划 5.2 节「无 LLM 降级模式」。当 LLM 不可用或用户显式 --no-llm 时，
 * 用纯结构化规则生成摘要，无需任何网络调用与密钥：
 *   - file_summary = 文件名 + ": " + 导出符号名列表（逗号分隔）
 *   - node_summary = 函数名 + 签名（若无签名则仅函数名）
 *   - 统一标记 summary_model = 'heuristic'，后续可用 LLM 重新生成（enrich）。
 */
import { basename } from "node:path";

/** 启发式摘要使用的模型标记 */
export const HEURISTIC_MODEL = "heuristic";

/** 参与启发式摘要的单个符号 */
export interface HeuristicSymbol {
  name: string;
  signature: string;
  isExported: boolean;
}

/**
 * 生成文件级启发式摘要。
 * 优先使用导出符号名；无导出符号时回退到全部符号名；再无则给出占位说明。
 */
export function heuristicFileSummary(
  filePath: string,
  symbols: readonly HeuristicSymbol[],
): string {
  const fileName = basename(filePath);
  const exported = symbols.filter((s) => s.isExported).map((s) => s.name);
  const names = exported.length > 0 ? exported : symbols.map((s) => s.name);
  if (names.length === 0) {
    return `${fileName}: 无导出符号`;
  }
  return `${fileName}: ${names.join(", ")}`;
}

/**
 * 生成节点级启发式摘要：函数名 + 签名。
 * 签名已包含参数与返回类型信息（由解析器产出）。
 */
export function heuristicNodeSummary(symbol: HeuristicSymbol): string {
  const sig = symbol.signature?.trim();
  return sig ? `${symbol.name}${sig.startsWith("(") ? "" : " "}${sig}` : symbol.name;
}

/** 启发式摘要的整文件结果 */
export interface HeuristicFileResult {
  fileSummary: string;
  /** name → summary */
  nodeSummaries: Map<string, string>;
}

/**
 * 对单个文件的符号集合一次性生成 file + node 启发式摘要。
 */
export function heuristicSummaries(
  filePath: string,
  symbols: readonly HeuristicSymbol[],
): HeuristicFileResult {
  const nodeSummaries = new Map<string, string>();
  for (const s of symbols) {
    nodeSummaries.set(s.name, heuristicNodeSummary(s));
  }
  return {
    fileSummary: heuristicFileSummary(filePath, symbols),
    nodeSummaries,
  };
}