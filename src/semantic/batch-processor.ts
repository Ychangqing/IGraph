/**
 * semantic/batch-processor.ts — 摘要批量处理器
 *
 * 职责（对应规划 5.2 批量处理流程）：
 * - 断点续传：只处理 files.summary_status = 'pending' 的文件，跳过 'done'。
 * - 并发控制：自实现轻量信号量（默认 maxConcurrency=5），不引入 p-limit。
 * - 进度：通过回调上报（CLI 层可接 cli-progress 或 logger）。
 * - 中断处理：监听 SIGINT，置停止标志，当前在途任务完成后优雅退出，不再取新任务。
 * - 错误处理：单文件重试由 LlmClient 内部负责；仍失败则标记 summary_status='error'，
 *   不中断整体；文件成功则写 file+node 摘要并置 'done'。
 *
 * 该模块与「摘要来源」解耦：调用方注入 summarizeFile 回调（LLM 或 heuristic），
 * 处理器只负责调度、落库与状态机。
 */
import type { DB } from "../graph/db.js";
import { logger } from "../utils/logger.js";
import {
  listFilesBySummaryStatus,
  updateFileSummary,
  setFileSummaryStatus,
  type FileRow,
} from "../graph/files.js";
import {
  getNodesByFile,
  updateNodeSummaries,
  setNodesSummaryStatusByFile,
  type NodeRow,
  type NodeSummaryUpdate,
} from "../graph/nodes.js";

/** 单文件摘要产出（file + 各 node 摘要 + 使用的模型/版本） */
export interface FileSummaryOutput {
  fileSummary: string;
  /** node name → summary */
  nodeSummaries: Map<string, string>;
  /** 记录到 summary_model 的值（如具体模型名或 'heuristic'） */
  model: string;
  /** 记录到 summary_prompt_ver 的值 */
  promptVersion: string;
}

/**
 * 摘要生成回调：给定文件行与其节点行，返回该文件的摘要产出。
 * 抛错表示该文件处理失败（将被标记 error）。
 */
export type SummarizeFile = (
  file: FileRow,
  nodes: NodeRow[],
) => Promise<FileSummaryOutput>;

/** 进度回调事件 */
export interface ProgressEvent {
  total: number;
  done: number;
  failed: number;
  /** 当前刚处理完的文件路径 */
  filePath: string;
  /** 该文件结果 */
  status: "done" | "error";
}

/** 批量处理选项 */
export interface BatchOptions {
  /** 最大并发，默认 5 */
  maxConcurrency?: number;
  /** 进度回调 */
  onProgress?: (event: ProgressEvent) => void;
  /**
   * 是否安装 SIGINT 处理器实现优雅中断，默认 true。
   * 测试可置 false 避免污染全局信号处理。
   */
  handleSigint?: boolean;
}

/** 批量处理结果统计 */
export interface BatchResult {
  /** 待处理（pending）文件总数 */
  total: number;
  /** 成功文件数 */
  done: number;
  /** 失败文件数 */
  failed: number;
  /** 是否因中断提前结束 */
  interrupted: boolean;
}

/**
 * 处理所有 pending 文件的摘要。
 *
 * @param db          已迁移的数据库连接
 * @param summarize   摘要生成回调（LLM 或 heuristic）
 * @param options     并发 / 进度 / 中断选项
 */
export async function processPendingFiles(
  db: DB,
  summarize: SummarizeFile,
  options: BatchOptions = {},
): Promise<BatchResult> {
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? 5);
  const handleSigint = options.handleSigint ?? true;

  const pending = listFilesBySummaryStatus(db, "pending");
  const total = pending.length;
  let done = 0;
  let failed = 0;
  let stopped = false;

  const onSigint = (): void => {
    stopped = true;
  };
  if (handleSigint) {
    process.on("SIGINT", onSigint);
  }

  // 简单信号量：以「取任务」游标 + 固定 worker 数实现有界并发。
  //
  // 并发安全说明（审查项 #4）：
  // - 并发边界：worker 数 = min(maxConcurrency, total)，各 worker 通过共享的
  //   `cursor` 领取任务。Node 单线程事件循环下，`const index = cursor; cursor += 1;`
  //   这段取号在同步代码块内执行、不含 await，不会被其它 worker 抢占，故每个
  //   pending 文件恰好被一个 worker 领取一次（无重复、无遗漏）。
  // - 状态写入安全：每个文件的落库（processOne → persistSuccess / markError）只
  //   UPDATE 该文件自身的主键行（files.id 及其 nodes.file_id 分组），worker 之间
  //   处理的是互不相交的文件集合，不存在对同一行的并发写。计数器 done/failed 的
  //   自增同样发生在 await 之后的同步段，无交错。
  // - 引擎保证：better-sqlite3 为同步 API，db.transaction() 内的写入是串行、阻塞
  //   完成的；即便多个 worker「逻辑并发」，真正落库时也被 SQLite 串行化。
  // - 未来改动注意：若改为跨文件共享可变状态、批量合并写同一行、或引入异步
  //   数据库驱动（非同步写），则上述「无共享可变状态 + 主键独立 UPDATE」的前提
  //   不再成立，需重新评估并发安全（可能要加锁或改回串行）。
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (stopped) return;
      // 取号：同步、无 await，事件循环不会在此切换 worker，故取号是原子的。
      const index = cursor;
      cursor += 1;
      if (index >= pending.length) return;
      const file = pending[index];
      if (file === undefined) return;

      // processOne 内部对「该文件」独立落库，与其它 worker 处理的文件互不重叠。
      const outcome = await processOne(db, file, summarize);
      if (outcome === "done") done += 1;
      else failed += 1;

      options.onProgress?.({
        total,
        done,
        failed,
        filePath: file.file_path,
        status: outcome,
      });
    }
  };

  try {
    const workers = Array.from(
      { length: Math.min(maxConcurrency, Math.max(1, total)) },
      () => worker(),
    );
    await Promise.all(workers);
  } finally {
    if (handleSigint) {
      process.off("SIGINT", onSigint);
    }
  }

  return {
    total,
    done,
    failed,
    interrupted: stopped && done + failed < total,
  };
}

/**
 * 处理单个文件：调用 summarize → 成功则落库并置 done；失败则标记 error。
 * 落库在单事务内完成（file + nodes 状态一致）。
 */
async function processOne(
  db: DB,
  file: FileRow,
  summarize: SummarizeFile,
): Promise<"done" | "error"> {
  const nodes = getNodesByFile(db, file.id);
  try {
    const output = await summarize(file, nodes);
    persistSuccess(db, file, nodes, output);
    return "done";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[LLM] 摘要生成失败 ${file.file_path}：${msg}`);
    // 单文件失败不中断整体：标记 file 与其 nodes 为 error。
    const markError = db.transaction(() => {
      setFileSummaryStatus(db, file.id, "error");
      setNodesSummaryStatusByFile(db, file.id, "error");
    });
    markError();
    return "error";
  }
}

/** 将成功产出写入 files/nodes（单事务，状态一致） */
function persistSuccess(
  db: DB,
  file: FileRow,
  nodes: NodeRow[],
  output: FileSummaryOutput,
): void {
  const nodeUpdates: NodeSummaryUpdate[] = nodes.map((n) => {
    const summary = output.nodeSummaries.get(n.name) ?? null;
    return {
      nodeId: n.id,
      summary,
      // 命中摘要则 done；模型未覆盖到的符号仍标 done（摘要为 null），
      // 避免因个别符号缺失导致文件反复重跑。
      status: "done" as const,
      model: output.model,
      promptVersion: output.promptVersion,
    };
  });

  const tx = db.transaction(() => {
    updateFileSummary(db, {
      fileId: file.id,
      fileSummary: output.fileSummary,
      status: "done",
      model: output.model,
      promptVersion: output.promptVersion,
    });
    if (nodeUpdates.length > 0) {
      updateNodeSummaries(db, nodeUpdates);
    }
  });
  tx();
}