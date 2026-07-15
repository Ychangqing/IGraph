# 配置说明

## 配置文件

`igraph init` 在当前目录生成 `.igraph/config.json`，图谱数据库位于 `.igraph/igraph.db`。

配置文件包含五个部分：

```jsonc
{
  "embedding": { ... },    // 向量化配置
  "llm": { ... },          // LLM 摘要配置
  "parser": { ... },       // 解析器配置
  "retrieval": { ... },    // 检索配置
  "multimodal": { ... }    // 多模态关联配置
}
```

## embedding — 向量化

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `baseURL` | string | `http://localhost:8080/v1` | Embedding API 地址 |
| `model` | string | `bge-m3` | Embedding 模型名称 |
| `dimensions` | number | `1024` | 向量维度 |
| `batchSize` | number | `32` | 批量嵌入大小 |

## llm — LLM 摘要

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `baseURL` | string | `https://api.openai.com/v1` | LLM API 地址 |
| `model` | string | `gpt-4o-mini` | 符号摘要模型 |
| `fileSummaryModel` | string | `gpt-4o` | 文件摘要模型 |
| `temperature` | number | `0` | 生成温度 |
| `maxConcurrency` | number | `5` | 最大并发请求数 |
| `promptVersion` | string | `v1.0` | Prompt 版本标识 |

## parser — 解析器

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `languages` | string[] | `["typescript", "javascript"]` | 启用的语言 |
| `include` | string[] | `["**/*"]` | 文件包含 glob |
| `exclude` | string[] | 见下文 | 文件排除 glob |

默认排除模式：

```json
["node_modules/**", "dist/**", "**/*.test.*", "**/*.spec.*", "**/*.d.ts"]
```

## retrieval — 检索

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `fileTopK` | number | `10` | 文件级检索返回数 |
| `nodeTopK` | number | `10` | 符号级检索返回数 |
| `fallbackThreshold` | number | `0.75` | 降级阈值 |
| `graphHops` | number | `2` | 图谱展开跳数 |
| `fusion` | string | `rrf` | 融合策略 |
| `rrfK` | number | `60` | RRF 融合参数 |
| `denseWeight` | number | `1.0` | Dense 通道权重 |
| `ftsWeight` | number | `1.0` | FTS5 通道权重 |
| `resourceTopK` | number | `3` | 独立资源检索返回数（直接搜索 resource_vectors） |

## multimodal — 多模态关联

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `strongLinkThreshold` | number | `0.85` | 强关联阈值 |
| `weakLinkThreshold` | number | `0.7` | 弱关联阈值 |
| `llmConfirmWeakLinks` | boolean | `false` | 是否用 LLM 确认弱关联 |

## 凭据管理

::: danger 安全约束
API Key 等敏感信息**禁止**写入项目级配置文件（防止提交到 git）。配置验证会主动扫描并拒绝含有凭据字段的项目配置。
:::

### 推荐方式 — 全局配置

使用 `igraph config set` 一次设置，所有项目自动共享：

```bash
igraph config set apiKey sk-xxx
igraph config set embedding.baseURL http://my-embedding:8080/v1
igraph config set llm.baseURL https://api.openai.com/v1
```

全局配置存储在 `~/.igraph/config.json`，可通过 `igraph config list` 查看。

### 环境变量（优先级最高）

| 环境变量 | 说明 | 是否必需 |
|---------|------|---------|
| `IGRAPH_API_KEY` | LLM / Embedding 通用密钥 | 联网命令必需 |
| `IGRAPH_EMBEDDING_BASE_URL` | 覆盖 `embedding.baseURL` | 可选 |
| `IGRAPH_LLM_BASE_URL` | 覆盖 `llm.baseURL` | 可选 |

### 优先级

**环境变量 > 全局配置（`~/.igraph/config.json`）> 项目配置（`.igraph/config.json`）**

```bash
# 环境变量方式（临时覆盖）
export IGRAPH_API_KEY="sk-..."
```

未提供 API Key 时：
- `build` / `rebuild` 可加 `--no-llm` 走启发式降级
- `query` / `eval` / `serve` 自动降级为仅 FTS5 通道检索
