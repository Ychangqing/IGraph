/**
 * cli/index.ts — CLI 构造器
 *
 * 组装 commander program：全局选项（--verbose/--quiet）+ 各子命令注册。
 * 与 bin 入口解耦，便于测试与库内复用。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { configureLogger } from "../utils/logger.js";
import { registerInit } from "./init.js";
import { registerBuild } from "./build.js";
import { registerQuery } from "./query.js";
import { registerEval } from "./eval.js";
import { registerServe } from "./serve.js";
import { registerMount } from "./mount.js";
import { registerStatus } from "./status.js";
import { registerRebuild } from "./rebuild.js";
import { registerRegister } from "./register.js";
import { registerConfig } from "./config.js";

/** 从 package.json 读取版本号，避免版本硬编码漂移 */
function resolveVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // 兼容 dist（打包后）与 src（ts-node/vitest）两种运行位置
    for (const rel of ["../package.json", "../../package.json"]) {
      try {
        const pkg = JSON.parse(readFileSync(join(here, rel), "utf-8")) as { version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        // 尝试下一个候选路径
      }
    }
  } catch {
    // 忽略：回退到占位版本
  }
  return "0.0.0";
}

/** 构建并返回配置完毕的 commander program */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("igraph")
    .description("代码知识图谱 CLI：解析 → 语义化 → 向量化 → 检索")
    .version(resolveVersion(), "-V, --version", "输出版本号")
    .option("-v, --verbose", "输出调试日志")
    .option("-q, --quiet", "仅输出错误日志")
    .hook("preAction", (thisCommand) => {
      const opts = thisCommand.opts<{ verbose?: boolean; quiet?: boolean }>();
      configureLogger({ verbose: opts.verbose, quiet: opts.quiet });
    });

  registerInit(program);
  registerBuild(program);
  registerRebuild(program);
  registerStatus(program);
  registerQuery(program);
  registerEval(program);
  registerServe(program);
  registerMount(program);
  registerRegister(program);
  registerConfig(program);

  return program;
}