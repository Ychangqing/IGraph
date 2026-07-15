/**
 * utils/logger.ts — 轻量日志器
 *
 * 支持 verbose / quiet 两级开关，供 CLI 全局选项控制输出粒度。
 * M0 仅提供最小可用实现，不引入第三方日志依赖。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  /** 打印 debug 级日志 */
  verbose?: boolean;
  /** 仅打印 error 级日志 */
  quiet?: boolean;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  private threshold: number;

  constructor(options: LoggerOptions = {}) {
    if (options.quiet) {
      this.threshold = LEVEL_ORDER.error;
    } else if (options.verbose) {
      this.threshold = LEVEL_ORDER.debug;
    } else {
      this.threshold = LEVEL_ORDER.info;
    }
  }

  private enabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= this.threshold;
  }

  debug(...args: unknown[]): void {
    if (this.enabled("debug")) console.debug(...args);
  }

  info(...args: unknown[]): void {
    if (this.enabled("info")) console.info(...args);
  }

  warn(...args: unknown[]): void {
    if (this.enabled("warn")) console.warn(...args);
  }

  error(...args: unknown[]): void {
    if (this.enabled("error")) console.error(...args);
  }
}

/** 全局默认 logger（可被 CLI 重新配置） */
export let logger = new Logger();

/** 依据 CLI 全局选项重建全局 logger */
export function configureLogger(options: LoggerOptions): Logger {
  logger = new Logger(options);
  return logger;
}