# IGraph

对代码仓库做 **解析 → 语义化 → 向量化**,构建多模态代码知识图谱的 Node.js CLI 工具。

IGraph 把一个仓库解析为「符号节点 + 调用关系边」的知识图谱,叠加 LLM 语义摘要与向量索引,再通过双通道(Dense + FTS5)RRF 融合检索能力对外服务;并可挂载 PRD / DB Schema 等多模态资源建立跨模态关联。它还内置 MCP Server,可直接接入 Cursor / Claude Code 等 AI 助手。

## 核心能力

- **多语言解析**:TypeScript / JavaScript / Python / Go / Java，tree-sitter 驱动的 5-Pass 流水线,提取函数/类/组件/变量及调用、继承、导入关系。
- **语义摘要**:对文件与符号生成 LLM 摘要(`--no-llm` 时走启发式降级,无需 API Key)。
- **向量检索**:BGE-M3 1024 维向量,SQLite + `sqlite-vec` 存储;Dense 与 FTS5 双通道经 RRF(`rrfK=60`)融合,支持 fallback。
- **多模态挂载**:挂载 PRD(.md/.txt/.pdf/.docx)与 DB Schema(.sql/.json/.xlsx),按语义相似度建立 `describes` / `reads` 关联边。
- **增量构建**:基于 SHA-256 diff 的级联更新,仅重建受影响文件。
- **MCP 集成**:`igraph serve` 以 stdio 暴露 4 个只读检索 tool,供 AI 助手调用。
- **凭据零硬编码**:API Key 等敏感信息通过**全局配置或环境变量**注入,禁止写入项目配置文件。

## 环境要求

- **Node.js >= 18**
- IGraph 依赖 `better-sqlite3` 与 tree-sitter 系列**原生(native)编译型插件**,安装时会在本机编译。请确保本机具备 C/C++ 构建工具链:
  - macOS:Xcode Command Line Tools(`xcode-select --install`)
  - Linux:`build-essential`、`python3`
  - Windows:`windows-build-tools` 或 Visual Studio Build Tools

## 安装

```bash
# 全局安装(提供 igraph 命令)
npm install -g igraph-cli
```

或在项目中本地安装:

```bash
npm install igraph-cli
```

> 全局选项:`-v, --verbose`(调试日志)、`-q, --quiet`(仅错误日志)、`-V, --version`(版本号)。

## 快速开始

以下是从初始化到 MCP 服务的完整流程:

```bash
# 1. 初始化配置文件 .igraph/config.json
igraph init

# 2. 注入凭据（全局配置，一次设置所有项目共享）
igraph config set apiKey sk-...
#   - 或通过环境变量：export IGRAPH_API_KEY="sk-..."

# 3. 构建图谱:解析 → 落库 → 摘要 → 向量化
igraph build
#   - 无凭据时可用启发式降级(跳过向量化):
igraph build --no-llm
#   - 仅预览解析统计,不写库:
igraph build --dry-run

# 4.(可选)挂载多模态资源
igraph mount prd docs/需求文档.md
igraph mount db  schema/db.sql

# 5. 检索:自然语言查询
igraph query "用户鉴权在哪里实现"
igraph query "JWT 校验" --top-k 5 --json

# 6. 查看图谱状态
igraph status

# 7. 注册 MCP Server 到 AI 助手（自动检测 Claude Code / Cursor）
igraph register

# 8. 或手动启动 MCP Server
igraph serve
```

首次 `build` 后再次运行会**自动增量更新**(基于文件 diff)。若需推倒重建:

```bash
igraph rebuild            # 清空并全量重建
igraph rebuild --no-llm   # 启发式降级重建
igraph rebuild --dry-run  # 仅预览,不删库不写库
```

## 配置说明

`igraph init` 在当前目录生成 `.igraph/config.json`,图谱数据库位于 `.igraph/igraph.db`。配置含五节:

```jsonc
{
  "embedding": {
    "baseURL": "http://localhost:8080/v1",
    "model": "bge-m3",
    "dimensions": 1024,
    "batchSize": 32
  },
  "llm": {
    "baseURL": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "fileSummaryModel": "gpt-4o",
    "temperature": 0,
    "maxConcurrency": 5,
    "promptVersion": "v1.0"
  },
  "parser": {
    "languages": ["typescript", "javascript"],
    "include": ["**/*"],
    "exclude": ["node_modules/**", "dist/**", "**/*.test.*", "**/*.spec.*", "**/*.d.ts"]
  },
  "retrieval": {
    "fileTopK": 10,
    "nodeTopK": 10,
    "fallbackThreshold": 0.75,
    "graphHops": 2,
    "fusion": "rrf",
    "rrfK": 60,
    "denseWeight": 1.0,
    "ftsWeight": 1.0
  },
  "multimodal": {
    "strongLinkThreshold": 0.85,
    "weakLinkThreshold": 0.7,
    "llmConfirmWeakLinks": false
  }
}
```

### 凭据管理(重要)

**凭据零硬编码**:API Key 等敏感信息禁止写入项目级 `.igraph/config.json`（防止提交到 git）。

推荐方式 — 全局配置（一次设置，所有项目共享）：

```bash
igraph config set apiKey sk-xxx
igraph config set embedding.baseURL http://my-embedding:8080/v1
```

也可通过环境变量提供：

```bash
export IGRAPH_API_KEY="sk-..."
```

| 来源 | 优先级 | 说明 |
|------|--------|------|
| 环境变量 | 最高 | `IGRAPH_API_KEY`、`IGRAPH_EMBEDDING_BASE_URL`、`IGRAPH_LLM_BASE_URL` |
| 全局配置 | 中 | `~/.igraph/config.json`（`igraph config set` 写入） |
| 项目配置 | 低 | `.igraph/config.json`（禁止含凭据字段） |

凭据优先级:**环境变量 > 全局配置 > 项目配置**。

> 未提供 API Key 时:`build`/`rebuild` 可加 `--no-llm` 走启发式降级并跳过向量化;`query`/`eval`/`serve` 会自动降级为**仅 FTS5 通道**检索,离线仍可用。

## 支持的语言与文件格式

| 类别      | 语言 / 类型      | 扩展名                           |
| --------- | ---------------- | -------------------------------- |
| 代码      | TypeScript       | `.ts` `.tsx` `.mts` `.cts`       |
| 代码      | JavaScript       | `.js` `.jsx` `.mjs` `.cjs`       |
| 代码      | Python           | `.py` `.pyi`                     |
| 代码      | Go               | `.go`                            |
| 代码      | Java             | `.java`                          |
| 多模态    | PRD 文档         | `.md` `.markdown` `.txt` `.pdf` `.docx` |
| 多模态    | DB Schema        | `.sql` `.ddl` `.json` `.xlsx`    |

## MCP 集成

`igraph serve` 以 MCP stdio 传输暴露 4 个只读检索 tool：`igraph_explore`、`igraph_node`、`igraph_file`、`igraph_related`。

### 自动注册（推荐）

```bash
# 自动检测已安装的 AI 助手并注册 MCP Server
igraph register

# 指定目标助手
igraph register --target claude
igraph register --target cursor
igraph register --target claude,cursor

# 注册到全局配置（所有项目共享）
igraph register --global

# 注销
igraph unregister
```

`igraph register` 会自动将 MCP Server 配置写入对应助手的配置文件：

| 助手 | 项目级 | 全局 |
|------|--------|------|
| Claude Code | `.mcp.json` | `~/.claude.json` |
| Cursor | `.cursor/mcp.json` | `~/.cursor/mcp.json` |

### 手动配置

也可以手动在 AI 助手的 MCP 配置文件中添加：

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

> `IGRAPH_API_KEY` 从用户 shell 环境自动继承，无需在配置中指定。未提供时 `igraph_explore` 自动降级为仅 FTS5 检索。

各 tool 的参数、返回结构与调用示例详见 [docs/mcp-tools.md](docs/mcp-tools.md)。

## 命令速查表

| 命令                | 说明                                       | 常用选项                                |
| ------------------- | ------------------------------------------ | --------------------------------------- |
| `igraph init`       | 初始化 `.igraph/config.json`               | `-f, --force`                           |
| `igraph build`      | 构建图谱(首次全量,后续自动增量)         | `--incremental` `--dry-run` `--no-llm`  |
| `igraph rebuild`    | 清空并从零全量重建                         | `--full` `--dry-run` `--no-llm`         |
| `igraph status`     | 查看图谱状态(规模/向量/资源/进度)       | —                                       |
| `igraph query`      | 自然语言检索(双通道 RRF + 图谱展开)     | `--top-k <n>` `--json`                  |
| `igraph eval`       | 评测检索质量(Recall@K / MRR / 耗时)     | `--test-set <path>` `--top-k <n>`       |
| `igraph serve`      | 启动 MCP Server（stdio）                   | —                                       |
| `igraph register`   | 注册 MCP Server 到 AI 助手配置             | `--target <targets>` `--global`         |
| `igraph unregister` | 从 AI 助手配置中移除 MCP Server 注册       | `--target <targets>` `--global`         |
| `igraph mount prd`  | 挂载 PRD 文档并关联代码文件                | `--top-k <n>`                           |
| `igraph mount db`   | 挂载 DB Schema 并关联代码文件              | `--top-k <n>`                           |
| `igraph config set` | 设置全局配置项（如 apiKey、embedding.baseURL）| `<key> <value>`                       |
| `igraph config get` | 获取全局配置项                             | `<key>`                                 |
| `igraph config list`| 列出全部全局配置                           | —                                       |

## 开发

```bash
npm run dev        # tsup watch 模式
npm test           # vitest 运行
npm run lint       # eslint
npm run format     # prettier
npm run typecheck  # tsc --noEmit
npm run build      # tsup 构建
```

发布前会自动执行 `prepublishOnly`(typecheck → test → build)校验并产出 `dist`。

## License

MIT