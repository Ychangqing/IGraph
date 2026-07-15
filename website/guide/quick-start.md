# 快速开始

本页展示从初始化到 AI 助手接入的完整流程。

## 1. 初始化配置

在项目根目录运行：

```bash
igraph init
```

这会生成 `.igraph/config.json` 配置文件，包含解析器、LLM、向量化等默认配置。

## 2. 注入凭据

### 方式一：全局配置（推荐，一次设置所有项目共享）

```bash
igraph config set apiKey sk-xxx
```

### 方式二：环境变量（临时覆盖或 CI 场景）

```bash
export IGRAPH_API_KEY="sk-..."
```

::: tip 无 API Key 也能用
加 `--no-llm` 可跳过 LLM 摘要和向量化，使用启发式降级方案。检索时自动降级为仅 FTS5 全文检索。
:::

## 3. 构建图谱

```bash
igraph build
```

首次运行会执行全量构建：解析 → 落库 → 摘要 → 向量化。

常用变体：

```bash
igraph build --no-llm    # 启发式降级（无需 API Key）
igraph build --dry-run   # 仅预览解析统计，不写库
```

## 4. 挂载外部资源（可选）

将 PRD 文档或 DB Schema 挂载到图谱，建立跨模态关联：

```bash
igraph mount prd docs/需求文档.md
igraph mount db  schema/db.sql
```

## 5. 检索验证

用自然语言查询图谱，验证构建结果：

```bash
igraph query "用户鉴权在哪里实现"
igraph query "JWT 校验" --top-k 5 --json
```

## 6. 查看图谱状态

```bash
igraph status
```

输出图谱规模（文件/节点/边数量）、向量索引状态、挂载资源列表等信息。

## 7. 注册到 AI 助手

一条命令自动将 MCP Server 注册到已安装的 AI 助手：

```bash
igraph register
```

`register` 会自动检测 Claude Code 和 Cursor，将 MCP 配置写入对应配置文件。也可指定目标：

```bash
igraph register --target claude
igraph register --target cursor
igraph register --global        # 全局配置（所有项目共享）
```

## 8. 手动启动 MCP Server（备选）

如果不使用 `register`，也可手动启动：

```bash
igraph serve
```

然后在 AI 助手的 MCP 配置文件中手动添加条目。详见 [MCP 集成](/features/mcp)。

## 增量更新

首次 `build` 后，再次运行会**自动增量更新**（基于文件 SHA-256 diff）：

```bash
igraph build    # 自动检测变更，仅重建受影响文件
```

如需全量重建：

```bash
igraph rebuild            # 清空并全量重建
igraph rebuild --no-llm   # 启发式降级重建
```

## 下一步

- [配置说明](/guide/configuration) — 了解完整配置项
- [核心功能](/features/parsing) — 深入了解各项能力
- [CLI 命令参考](/reference/cli) — 查看所有命令的完整选项
