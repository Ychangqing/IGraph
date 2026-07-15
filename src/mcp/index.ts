/**
 * mcp/index.ts — igraph MCP Server（stdio 传输，P2 / M6）
 *
 * 用 @modelcontextprotocol/sdk 暴露一个 MCP Server，将 igraph 的双通道检索 /
 * 图谱查询能力以 MCP tools 形式提供给支持 MCP 的客户端（IDE / Agent）。
 *
 * 传输：stdio（stdin/stdout 承载 JSON-RPC）。日志必须走 stderr，切勿写 stdout，
 *   否则会污染 MCP 协议帧。
 *
 * tools 见 ./tools.ts；本模块只负责：装配 Server、注册 ListTools / CallTool
 *   两个请求处理器、连接 stdio 传输，并把 handler 结果序列化为 MCP text content。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "../config/index.js";
import { openDatabase, closeDatabase, type DB } from "../graph/index.js";
import { TOOL_DEFINITIONS, dispatchTool, ToolInputError, type ToolContext } from "./tools.js";
import { generateInstructions } from "./server-instructions.js";

/** MCP Server 名称（version 与 package.json 对齐，避免硬编码漂移） */
const SERVER_NAME = "igraph";

/** 从 package.json 读取版本号（兼容 dist 与 src 两种运行位置） */
function resolveVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
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

/**
 * 组装 MCP Server 并注册请求处理器（不含传输连接，便于测试）。
 *
 * @param ctx          tool 执行上下文（db + config + 可选 EmbeddingClient 工厂）
 * @param instructions MCP instructions（注入 AI 系统提示，引导工具使用）
 */
export function createMcpServer(ctx: ToolContext, instructions?: string): Server {
  const server = new Server(
    { name: SERVER_NAME, version: resolveVersion() },
    {
      capabilities: { tools: {} },
      ...(instructions && { instructions }),
    },
  );

  // ListTools：返回 4 个 tool 的手写 JSON Schema 定义。
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  // CallTool：分发到对应 handler，结果序列化为 text content。
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const { name, arguments: rawArgs } = req.params;
    try {
      const result = await dispatchTool(ctx, name, rawArgs ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      // 校验错误 / 未知 tool → isError 结果（而非抛出协议级异常），
      // 让客户端能读取到人类可读的错误说明。
      const message =
        err instanceof ToolInputError
          ? `输入错误：${err.message}`
          : `执行 ${name} 失败：${err instanceof Error ? err.message : String(err)}`;
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * 启动 igraph MCP Server（stdio）。阻塞直到传输关闭。
 *
 * 降级：以 requireApiKey=false 加载配置，无 IGRAPH_API_KEY 时 explore 自动走
 *   仅 FTS5 通道（见 tools.handleExplore），保证离线可用、不崩溃。
 *
 * @param cwd 工作目录（默认 process.cwd()）
 */
export async function startMcpServer(cwd: string = process.cwd()): Promise<void> {
  // 检索支持降级，不强制要求 API Key。
  const config = loadConfig(cwd, false);
  const db: DB = openDatabase(cwd);
  const ctx: ToolContext = { db, config };

  const instructions = generateInstructions(db);
  const server = createMcpServer(ctx, instructions);
  const transport = new StdioServerTransport();

  // 传输关闭时清理数据库连接。
  transport.onclose = (): void => {
    try {
      closeDatabase(db);
    } catch {
      // 忽略关闭异常
    }
  };

  await server.connect(transport);
  // connect 后进入 stdio 事件循环，进程随 stdin 关闭而退出。
}