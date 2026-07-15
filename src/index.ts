/**
 * index.ts — 库入口（公共 API）
 *
 * 对外暴露 M0 已就绪的稳定接口：配置系统、日志器、CLI 构造器。
 * M1+ 模块（parser/graph/semantic/vector/... ）在各自里程碑就绪后再从此导出。
 */

// 配置系统：类型定义、默认配置、加载与凭据注入
export * from "./config/index.js";

// 日志器
export { Logger, configureLogger, logger } from "./utils/logger.js";
export type { LogLevel, LoggerOptions } from "./utils/logger.js";

// CLI 构造器（便于以编程方式复用）
export { buildProgram } from "./cli/index.js";