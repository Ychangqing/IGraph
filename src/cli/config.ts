/**
 * cli/config.ts — `igraph config` 命令组
 *
 * 管理全局配置（~/.igraph/config.json）：
 * - igraph config set <key> <value>
 * - igraph config get <key>
 * - igraph config list
 * - igraph config path
 */
import { Command } from "commander";
import { logger } from "../utils/logger.js";
import {
  readGlobalConfig,
  setGlobalConfigValue,
  getGlobalConfigValue,
  GLOBAL_CONFIG_PATH,
} from "../config/global.js";

/** 脱敏显示（保留前3位和后3位，中间用 **** 代替） */
function maskSecret(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 3) + "****" + value.slice(-3);
}

export function registerConfig(program: Command): void {
  const configCmd = program
    .command("config")
    .description("管理全局配置（~/.igraph/config.json）");

  configCmd
    .command("set <key> <value>")
    .description("设置全局配置项（如 apiKey、embedding.baseURL）")
    .action((key: string, value: string) => {
      try {
        setGlobalConfigValue(key, value);
        const display = key.toLowerCase().includes("key") || key.toLowerCase().includes("secret")
          ? maskSecret(value)
          : value;
        logger.info(`已设置 ${key} = ${display}`);
        logger.info(`配置文件：${GLOBAL_CONFIG_PATH}`);
      } catch (err) {
        logger.error((err as Error).message);
        process.exitCode = 1;
      }
    });

  configCmd
    .command("get <key>")
    .description("获取全局配置项")
    .action((key: string) => {
      const value = getGlobalConfigValue(key);
      if (value === undefined) {
        logger.info(`${key} 未设置`);
      } else {
        const str = String(value);
        const display = key.toLowerCase().includes("key") || key.toLowerCase().includes("secret")
          ? maskSecret(str)
          : str;
        logger.info(`${key} = ${display}`);
      }
    });

  configCmd
    .command("list")
    .description("列出全部全局配置")
    .action(() => {
      const config = readGlobalConfig();
      if (Object.keys(config).length === 0) {
        logger.info("全局配置为空。使用 `igraph config set <key> <value>` 进行设置。");
        return;
      }
      // 脱敏输出
      const display = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
      if (
        display.credentials &&
        typeof display.credentials === "object" &&
        (display.credentials as Record<string, unknown>).apiKey
      ) {
        (display.credentials as Record<string, unknown>).apiKey = maskSecret(
          String((display.credentials as Record<string, unknown>).apiKey),
        );
      }
      logger.info(JSON.stringify(display, null, 2));
    });

  configCmd
    .command("path")
    .description("打印全局配置文件路径")
    .action(() => {
      logger.info(GLOBAL_CONFIG_PATH);
    });
}
