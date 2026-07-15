/**
 * cli/init.ts — `igraph init` 命令
 *
 * 在当前工作目录生成 `.igraph/config.json`（以 DEFAULT_CONFIG 为模板）。
 * 该命令不需要凭据，也不会写入任何密钥。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Command } from "commander";
import { DEFAULT_CONFIG, configExists, getConfigPath } from "../config/index.js";
import { logger } from "../utils/logger.js";

export interface InitOptions {
  /** 已存在时是否覆盖 */
  force?: boolean;
}

/** 执行 init 逻辑（与命令解析解耦，便于测试） */
export function runInit(cwd: string = process.cwd(), options: InitOptions = {}): string {
  const path = getConfigPath(cwd);
  if (configExists(cwd) && !options.force) {
    logger.warn(`配置文件已存在：${path}（使用 --force 覆盖）`);
    return path;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf-8");
  logger.info(`已生成配置文件：${path}`);
  logger.info(`提示：凭据请通过环境变量 IGRAPH_API_KEY 提供，切勿写入配置文件。`);
  return path;
}

/** 注册 init 子命令 */
export function registerInit(program: Command): void {
  program
    .command("init")
    .description("在当前目录初始化 .igraph/config.json")
    .option("-f, --force", "覆盖已存在的配置文件")
    .action((options: InitOptions) => {
      runInit(process.cwd(), options);
    });
}