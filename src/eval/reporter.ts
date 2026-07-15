/**
 * eval/reporter.ts — 评测报告的终端表格渲染
 *
 * 把 EvalReport 渲染为人类可读的终端文本：
 * - 顶部汇总：Recall@K / MRR / Avg Query Time；
 * - 明细表：每条 query 的 recall / RR / 首命中排名 / 耗时；
 * - 降级提示：由入口层通过 note 传入（如「无 Embedding 服务，仅 FTS5 通道」）。
 *
 * 纯字符串拼装，不做 I/O，便于单测。
 */
import type { EvalReport } from "./metrics.js";

/** 报告渲染的附加信息 */
export interface ReportContext {
  /** 数据集路径（展示用） */
  datasetPath?: string;
  /** 检索模式说明（如 "dense+fts5" / "fts5-only(降级)"） */
  mode?: string;
  /** 额外备注（如降级原因） */
  note?: string;
}

/** 固定小数位 */
function fixed(n: number, digits = 4): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "-";
}

/** 右侧补齐到指定宽度（用于列对齐，按显示字符数近似） */
function padEnd(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/** 左侧补齐 */
function padStart(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

/** 截断过长字符串 */
function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/**
 * 渲染评测报告为终端文本。
 */
export function renderReport(report: EvalReport, ctx: ReportContext = {}): string {
  const lines: string[] = [];

  lines.push("══════════════════════════════════════════════");
  lines.push("  IGraph 检索评测报告");
  lines.push("══════════════════════════════════════════════");
  if (ctx.datasetPath) lines.push(`数据集：${ctx.datasetPath}`);
  if (ctx.mode) lines.push(`检索模式：${ctx.mode}`);
  lines.push(
    `样本：${report.totalCount} 条（有效 ${report.validCount} 条，` +
      `空 expected ${report.totalCount - report.validCount} 条）`,
  );
  lines.push("");

  // ── 汇总指标 ──
  lines.push("── 汇总指标 ──");
  lines.push(`  Recall@${report.k}      : ${fixed(report.recallAtK)}`);
  lines.push(`  MRR             : ${fixed(report.mrr)}`);
  lines.push(`  Avg Query Time  : ${fixed(report.avgQueryTimeMs, 2)} ms`);
  lines.push("");

  // ── 明细表 ──
  const cols = {
    idx: 3,
    query: 32,
    recall: 9,
    rr: 8,
    hit: 8,
    time: 10,
  };
  const header =
    padStart("#", cols.idx) +
  "  " +
    padEnd("query", cols.query) +
    "  " +
    padStart(`recall@${report.k}`, cols.recall) +
    "  " +
    padStart("RR", cols.rr) +
    "  " +
    padStart("hit@", cols.hit) +
    "  " +
    padStart("time(ms)", cols.time);
  lines.push("── 明细 ──");
  lines.push(header);
  lines.push("-".repeat(header.length));

  report.cases.forEach((c, i) => {
    const row =
      padStart(String(i + 1), cols.idx) +
      "  " +
      padEnd(truncate(c.query, cols.query), cols.query) +
      "  " +
      padStart(c.recall === null ? "n/a" : fixed(c.recall, 3), cols.recall) +
      "  " +
      padStart(c.reciprocalRank === null ? "n/a" : fixed(c.reciprocalRank, 3), cols.rr) +
      "  " +
      padStart(c.firstHitRank === null ? "miss" : String(c.firstHitRank), cols.hit) +
      "  " +
      padStart(fixed(c.elapsedMs, 1), cols.time);
    lines.push(row);
  });

  if (ctx.note) {
    lines.push("");
    lines.push(`注：${ctx.note}`);
  }

  lines.push("══════════════════════════════════════════════");
  return lines.join("\n");
}