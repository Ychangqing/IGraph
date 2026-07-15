# 配置 Schema

## 完整配置文件

`igraph init` 生成的 `.igraph/config.json` 完整结构：

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
    "exclude": [
      "node_modules/**",
      "dist/**",
      "**/*.test.*",
      "**/*.spec.*",
      "**/*.d.ts"
    ]
  },
  "retrieval": {
    "fileTopK": 10,
    "nodeTopK": 10,
    "fallbackThreshold": 0.75,
    "graphHops": 2,
    "fusion": "rrf",
    "rrfK": 60,
    "denseWeight": 1.0,
    "ftsWeight": 1.0,
    "resourceTopK": 3
  },
  "multimodal": {
    "strongLinkThreshold": 0.85,
    "weakLinkThreshold": 0.7,
    "llmConfirmWeakLinks": false
  }
}
```

## 配置节说明

### embedding

控制向量化行为。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `baseURL` | string | `http://localhost:8080/v1` | Embedding API 地址。可被 `IGRAPH_EMBEDDING_BASE_URL` 环境变量覆盖 |
| `model` | string | `bge-m3` | Embedding 模型名称 |
| `dimensions` | number | `1024` | 向量维度，需与模型匹配 |
| `batchSize` | number | `32` | 每次批量嵌入的数量 |

### llm

控制 LLM 语义摘要生成。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `baseURL` | string | `https://api.openai.com/v1` | LLM API 地址。可被 `IGRAPH_LLM_BASE_URL` 环境变量覆盖 |
| `model` | string | `gpt-4o-mini` | 符号摘要使用的模型 |
| `fileSummaryModel` | string | `gpt-4o` | 文件摘要使用的模型 |
| `temperature` | number | `0` | 生成温度（0 = 确定性输出） |
| `maxConcurrency` | number | `5` | 最大并发请求数 |
| `promptVersion` | string | `v1.0` | Prompt 版本标识，变更后触发全量重建 |

### parser

控制源代码解析行为。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `languages` | string[] | `["typescript", "javascript"]` | 启用的语言列表 |
| `include` | string[] | `["**/*"]` | 文件包含 glob 模式 |
| `exclude` | string[] | 见上文 | 文件排除 glob 模式 |

### retrieval

控制检索行为。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `fileTopK` | number | `10` | 文件级检索返回数量 |
| `nodeTopK` | number | `10` | 符号级检索返回数量 |
| `fallbackThreshold` | number | `0.75` | 降级阈值 |
| `graphHops` | number | `2` | 图谱展开跳数（0 = 不展开） |
| `fusion` | string | `rrf` | 融合策略 |
| `rrfK` | number | `60` | RRF 参数 K 值 |
| `denseWeight` | number | `1.0` | Dense 通道权重 |
| `ftsWeight` | number | `1.0` | FTS5 通道权重 |
| `resourceTopK` | number | `3` | 独立资源检索 Top-K（直接搜索 resource_vectors，不依赖 resource_edges） |

### multimodal

控制多模态资源关联行为。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `strongLinkThreshold` | number | `0.85` | 强关联阈值 |
| `weakLinkThreshold` | number | `0.7` | 弱关联阈值 |
| `llmConfirmWeakLinks` | boolean | `false` | 是否用 LLM 确认弱关联 |

## 安全约束

::: danger
配置文件**禁止包含任何凭据字段**（如 `apiKey`、`token`、`secret` 等）。IGraph 的配置验证会主动扫描并拒绝包含这些字段的配置文件。

API Key 等敏感信息只能通过[环境变量](/reference/env-variables)提供。
:::
