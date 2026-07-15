# CLI 命令参考

## igraph init

初始化项目配置。

```bash
igraph init [options]
```

| 选项 | 说明 |
|------|------|
| `-f, --force` | 强制覆盖已存在的配置文件 |

在当前目录生成 `.igraph/config.json`。如果配置文件已存在，默认跳过；加 `--force` 覆盖。

## igraph build

构建代码知识图谱。

```bash
igraph build [options]
```

| 选项 | 说明 |
|------|------|
| `--incremental` | 显式增量模式（默认自动检测） |
| `--dry-run` | 仅预览解析统计，不写入数据库 |
| `--no-llm` | 跳过 LLM 摘要和向量化，使用启发式降级 |

首次运行执行全量构建；后续运行自动增量更新（基于 SHA-256 diff）。

## igraph rebuild

清空数据库并全量重建。

```bash
igraph rebuild [options]
```

| 选项 | 说明 |
|------|------|
| `--full` | 全量重建（默认行为） |
| `--dry-run` | 仅预览，不删库不写库 |
| `--no-llm` | 启发式降级重建 |

适用于更换 LLM 模型、修改解析配置后需要从零构建的场景。

## igraph status

查看图谱状态。

```bash
igraph status
```

输出信息包括：
- 文件数量、节点数量、边数量
- 向量索引状态
- 已挂载的多模态资源
- 构建进度

## igraph query

自然语言检索代码图谱。

```bash
igraph query <question> [options]
```

| 选项 | 说明 |
|------|------|
| `--top-k <n>` | 返回结果数量（默认 5） |
| `--json` | 以 JSON 格式输出结果 |

示例：

```bash
igraph query "用户鉴权在哪里实现"
igraph query "JWT 校验" --top-k 10 --json
```

## igraph eval

评测检索质量。

```bash
igraph eval [options]
```

| 选项 | 说明 |
|------|------|
| `--test-set <path>` | 测试集文件路径 |
| `--top-k <n>` | 评测时的 top-K 值 |

输出 Recall@K、MRR 和耗时等指标。

## igraph serve

启动 MCP Server（stdio 传输）。

```bash
igraph serve
```

以当前工作目录为仓库根目录启动，暴露 4 个只读检索 Tool。通常不直接使用，由 AI 助手通过 MCP 配置自动调用。

## igraph register

将 MCP Server 注册到 AI 助手配置中。

```bash
igraph register [options]
```

| 选项 | 说明 |
|------|------|
| `-t, --target <targets>` | 目标助手（`auto` / `claude` / `cursor`，逗号分隔），默认 `auto` |
| `-g, --global` | 写入全局配置而非项目级配置 |

`auto` 模式自动检测已安装的 Claude Code 和 Cursor。

示例：

```bash
igraph register                       # 自动检测并注册
igraph register --target claude       # 仅 Claude Code
igraph register --target cursor       # 仅 Cursor
igraph register --global              # 写入全局配置
```

## igraph unregister

从 AI 助手配置中移除 MCP Server 注册。

```bash
igraph unregister [options]
```

| 选项 | 说明 |
|------|------|
| `-t, --target <targets>` | 目标助手（`auto` / `claude` / `cursor`，逗号分隔），默认 `auto` |
| `-g, --global` | 从全局配置移除 |

## igraph mount prd

挂载 PRD 文档。

```bash
igraph mount prd <path> [options]
```

| 选项 | 说明 |
|------|------|
| `--top-k <n>` | 关联匹配数量 |

支持格式：`.md` `.txt` `.pdf` `.docx`

## igraph mount db

挂载 DB Schema。

```bash
igraph mount db <path> [options]
```

| 选项 | 说明 |
|------|------|
| `--top-k <n>` | 关联匹配数量 |

支持格式：`.sql` `.ddl` `.json` `.xlsx`

## igraph config

管理全局配置（`~/.igraph/config.json`）。

### igraph config set

```bash
igraph config set <key> <value>
```

设置全局配置项。支持的 key：

| Key | 说明 | 示例 |
|-----|------|------|
| `apiKey` | API Key | `igraph config set apiKey sk-xxx` |
| `embeddingBaseURL` | Embedding 服务地址 | `igraph config set embeddingBaseURL http://localhost:8080/v1` |
| `llmBaseURL` | LLM 服务地址 | `igraph config set llmBaseURL https://api.openai.com/v1` |
| `section.field` | 任意配置字段 | `igraph config set llm.model gpt-4o-mini` |

### igraph config get

```bash
igraph config get <key>
```

获取全局配置项（凭据会脱敏显示）。

### igraph config list

```bash
igraph config list
```

列出全部全局配置内容。

### igraph config path

```bash
igraph config path
```

打印全局配置文件路径（`~/.igraph/config.json`）。
