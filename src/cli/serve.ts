/**
 * cli/serve.ts — `igraph serve` 命令（P2 / M6）
 *
 * 启动 igraph MCP Server（stdio 传输），让支持 MCP 的客户端（IDE / Agent）
 * 通过标准输入输出调用 igraph 的检索能力（explore / node / file / related）。
 *
 * 用法：
 *   igraph serve
 * 在 MCP 客户端配置中以 stdio 方式调起本命令即可（command=igraph, args=["serve"]）。
 *
 * 注意：MCP stdio 协议独占 stdout 承载 JSON-RPC 帧，因此本命令严禁向 stdout
 *   打印任何非协议内容；启动/诊断信息一律走 stderr（logger 已写 stderr）。
 *
 * 降级：无 IGRAPH_API_KEY 时 explore 自动降级为仅 FTS5 检索（见 mcp/tools），
 *   免密钥即可提供离线查询能力。
 */
import { Command } from "commander";
import { startMcpServer } from "../mcp/index.js";

export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("启动 igraph MCP Server（stdio），向支持 MCP 的客户端暴露检索能力")
    .action(async () => {
      const cwd = process.cwd();
      // 诊断信息强制走 stderr：stdout 被 MCP JSON-RPC 帧独占，不可写入其它内容。
      // 不使用 logger.info（其底层为 console.info → stdout），避免协议污染。
      process.stderr.write("igraph MCP Server 启动中（stdio 传输）……\n");
      await startMcpServer(cwd);
    });
}