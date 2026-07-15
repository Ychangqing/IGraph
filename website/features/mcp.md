# MCP 集成

IGraph 内置 MCP（Model Context Protocol）Server，可直接接入 Cursor、Claude Code 等 AI 助手，让 AI 在编码时查询代码知识图谱。

## 什么是 MCP？

MCP 是一种标准化的协议，允许 AI 助手调用外部工具。IGraph 的 MCP Server 通过 **stdio 传输** 暴露 4 个只读检索工具，AI 助手可以用自然语言向图谱提问。

## 快速接入

### 自动注册（推荐）

一条命令完成配置：

```bash
igraph register
```

`register` 自动检测已安装的 AI 助手并写入配置。支持的目标：

| 助手 | 项目级配置 | 全局配置 |
|------|-----------|---------|
| Claude Code | `.mcp.json` | `~/.claude.json` |
| Cursor | `.cursor/mcp.json` | `~/.cursor/mcp.json` |

更多选项：

```bash
igraph register --target claude      # 仅注册到 Claude Code
igraph register --target cursor      # 仅注册到 Cursor
igraph register --global             # 写入全局配置
igraph unregister                    # 注销
```

### 手动配置

在 AI 助手的 MCP 配置文件中添加：

```json
{
  "mcpServers": {
    "igraph": {
      "type": "stdio",
      "command": "igraph",
      "args": ["serve"]
    }
  }
}
```

`IGRAPH_API_KEY` 从用户 shell 环境自动继承，无需在配置中指定。

## 暴露的 MCP Tools

| Tool | 说明 |
|------|------|
| `igraph_explore` | 自然语言检索，附带图谱上下文展开 |
| `igraph_node` | 按符号名获取节点详情（源码 + 调用者/被调用者） |
| `igraph_file` | 按文件路径获取文件图谱信息 |
| `igraph_related` | 展开某符号的关联资源 |

所有 Tool 均为**只读**，不修改数据库。

详细的参数、返回结构和调用示例见 [MCP Tool 详解](/reference/mcp-tools)。

## 降级行为

| 场景 | `igraph_explore` 行为 |
|------|----------------------|
| 有 API Key + 有向量 | Dense + FTS5 双通道 RRF 融合 |
| 无 API Key | 自动降级为仅 FTS5 检索 |

其他三个 Tool（`igraph_node`、`igraph_file`、`igraph_related`）不依赖向量，始终可用。

## 注意事项

- MCP stdio 协议独占 stdout 承载 JSON-RPC 帧，IGraph 的诊断日志走 stderr
- `igraph serve` 以当前工作目录为仓库根目录启动
- 确保当前目录下已有 `.igraph/igraph.db`（即已执行过 `igraph build`）
