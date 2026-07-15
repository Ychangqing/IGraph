# 环境变量

IGraph 遵循**凭据零硬编码**原则，所有敏感信息只能通过环境变量注入。

## 变量列表

| 环境变量 | 说明 | 是否必需 |
|---------|------|---------|
| `IGRAPH_API_KEY` | LLM / Embedding 通用密钥 | 联网命令（LLM 摘要 / 向量化）必需 |
| `IGRAPH_EMBEDDING_BASE_URL` | 覆盖 `embedding.baseURL` 配置 | 可选 |
| `IGRAPH_LLM_BASE_URL` | 覆盖 `llm.baseURL` 配置 | 可选 |

## 优先级

**环境变量 > 项目配置文件**

当同时存在环境变量和配置文件中的值时，环境变量优先。

## 设置方式

### 临时设置（当前终端会话）

```bash
export IGRAPH_API_KEY="sk-..."
export IGRAPH_EMBEDDING_BASE_URL="http://localhost:8080/v1"
```

### 持久化设置

将环境变量添加到 shell 配置文件：

```bash
# ~/.bashrc 或 ~/.zshrc
export IGRAPH_API_KEY="sk-..."
```

::: warning
**切勿**将 API Key 写入以下位置：
- `.igraph/config.json` 配置文件
- 代码仓库中的任何文件
- MCP 配置文件（`.mcp.json` 等）

IGraph 会主动扫描并拒绝包含凭据字段的配置。
:::

## 无 API Key 时的行为

| 命令 | 行为 |
|------|------|
| `igraph build` | 加 `--no-llm` 可执行（跳过摘要和向量化） |
| `igraph rebuild` | 加 `--no-llm` 可执行 |
| `igraph query` | 自动降级为仅 FTS5 全文检索 |
| `igraph eval` | 自动降级为仅 FTS5 全文检索 |
| `igraph serve` | MCP Server 正常启动，`igraph_explore` 降级为仅 FTS5 |
| `igraph init` | 不需要 API Key |
| `igraph status` | 不需要 API Key |
| `igraph register` | 不需要 API Key |

## MCP Server 中的凭据传递

使用 `igraph register` 注册时，**不会**在 MCP 配置中写入 `env` 字段。API Key 从用户的 shell 环境自动继承。

这意味着：
- 在启动 AI 助手前，确保终端中已 `export IGRAPH_API_KEY`
- 或将其添加到 shell 配置文件中以持久化
