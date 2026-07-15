/**
 * cli/register.ts — `igraph register` / `igraph unregister` 命令
 *
 * 自动将 igraph MCP Server 注册到已安装的 AI 助手（Claude Code / Cursor）配置中，
 * 或从中移除。支持项目级（默认）和全局两种配置位置。
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Command } from "commander";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TargetId = "claude" | "cursor";

interface Target {
  id: TargetId;
  displayName: string;
  configPath: (isGlobal: boolean, cwd: string) => string;
  detect: () => boolean;
}

export interface RegisterOptions {
  target?: string;
  global?: boolean;
}

// ---------------------------------------------------------------------------
// Target definitions
// ---------------------------------------------------------------------------

const TARGETS: Target[] = [
  {
    id: "claude",
    displayName: "Claude Code",
    configPath: (isGlobal, cwd) =>
      isGlobal
        ? join(homedir(), ".claude.json")
        : join(cwd, ".mcp.json"),
    detect: () => existsSync(join(homedir(), ".claude.json")),
  },
  {
    id: "cursor",
    displayName: "Cursor",
    configPath: (isGlobal, cwd) =>
      isGlobal
        ? join(homedir(), ".cursor", "mcp.json")
        : join(cwd, ".cursor", "mcp.json"),
    detect: () => existsSync(join(homedir(), ".cursor")),
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMcpEntry(): Record<string, unknown> {
  return { type: "stdio", command: "igraph", args: ["serve"] };
}

/**
 * 读取 JSON 文件。
 * - 文件不存在 → 返回 { exists: false, data: null }
 * - JSON 解析失败 → 返回 { exists: true, data: null }（调用方负责备份）
 * - 成功 → 返回 { exists: true, data }
 */
export function readJsonSafe(path: string): {
  exists: boolean;
  data: Record<string, unknown> | null;
} {
  if (!existsSync(path)) return { exists: false, data: null };
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { exists: true, data: parsed };
  } catch {
    return { exists: true, data: null };
  }
}

function jsonDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveTargets(targetStr: string): Target[] {
  if (targetStr === "auto") {
    const detected = TARGETS.filter((t) => t.detect());
    if (detected.length === 0) {
      logger.warn("未检测到已安装的 AI 助手（Claude Code / Cursor）");
    }
    return detected;
  }
  const ids = targetStr.split(",").map((s) => s.trim()) as TargetId[];
  const result: Target[] = [];
  for (const id of ids) {
    const target = TARGETS.find((t) => t.id === id);
    if (target) {
      result.push(target);
    } else {
      logger.warn(`未知的 target：${id}（可选值：claude, cursor）`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

export function runRegister(
  cwd: string = process.cwd(),
  options: RegisterOptions = {},
): void {
  const targets = resolveTargets(options.target ?? "auto");
  const isGlobal = options.global ?? false;
  const entry = buildMcpEntry();

  for (const target of targets) {
    const configPath = target.configPath(isGlobal, cwd);

    // 全局模式下，如果全局配置文件/目录不存在，说明助手未安装
    if (isGlobal && !target.detect()) {
      logger.warn(
        `${target.displayName} 未检测到，跳过（${configPath} 不存在）`,
      );
      continue;
    }

    const { exists, data } = readJsonSafe(configPath);

    if (exists && data === null) {
      // JSON 损坏，备份后覆盖
      const bakPath = `${configPath}.bak`;
      copyFileSync(configPath, bakPath);
      logger.warn(`${configPath} JSON 格式异常，已备份到 ${bakPath}`);
    }

    const config = data ?? {};
    const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;

    // 幂等检查
    if (jsonDeepEqual(mcpServers.igraph, entry)) {
      logger.info(
        `igraph 已注册到 ${target.displayName}，无需更新：${configPath}`,
      );
      continue;
    }

    mcpServers.igraph = entry;
    config.mcpServers = mcpServers;

    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
    logger.info(`已注册到 ${target.displayName}：${configPath}`);
  }
}

export function runUnregister(
  cwd: string = process.cwd(),
  options: RegisterOptions = {},
): void {
  const targets = resolveTargets(options.target ?? "auto");
  const isGlobal = options.global ?? false;

  for (const target of targets) {
    const configPath = target.configPath(isGlobal, cwd);
    const { exists, data } = readJsonSafe(configPath);

    if (!exists || data === null) {
      logger.info(`${target.displayName} 未注册 igraph，跳过：${configPath}`);
      continue;
    }

    const mcpServers = data.mcpServers as
      | Record<string, unknown>
      | undefined;
    if (!mcpServers || !("igraph" in mcpServers)) {
      logger.info(`${target.displayName} 未注册 igraph，跳过：${configPath}`);
      continue;
    }

    delete mcpServers.igraph;

    // 清理空的 mcpServers 键
    if (Object.keys(mcpServers).length === 0) {
      delete data.mcpServers;
    }

    // 如果整个文件变空了，删除文件（仅项目级配置文件）
    if (!isGlobal && Object.keys(data).length === 0) {
      unlinkSync(configPath);
      logger.info(`已从 ${target.displayName} 注销并删除空配置：${configPath}`);
    } else {
      writeFileSync(
        configPath,
        `${JSON.stringify(data, null, 2)}\n`,
        "utf-8",
      );
      logger.info(`已从 ${target.displayName} 注销：${configPath}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Commander registration
// ---------------------------------------------------------------------------

export function registerRegister(program: Command): void {
  program
    .command("register")
    .description(
      "将 igraph MCP Server 注册到 AI 助手（Claude Code / Cursor）配置中",
    )
    .option(
      "-t, --target <targets>",
      "目标助手（auto / claude / cursor，逗号分隔）",
      "auto",
    )
    .option("-g, --global", "写入全局配置而非项目级配置")
    .action((options: RegisterOptions) => {
      runRegister(process.cwd(), options);
    });

  program
    .command("unregister")
    .description("从 AI 助手配置中移除 igraph MCP Server 注册")
    .option(
      "-t, --target <targets>",
      "目标助手（auto / claude / cursor，逗号分隔）",
      "auto",
    )
    .option("-g, --global", "从全局配置移除而非项目级配置")
    .action((options: RegisterOptions) => {
      runUnregister(process.cwd(), options);
    });
}
