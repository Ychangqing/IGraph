# 向量检索

IGraph 使用 **Dense + FTS5 双通道** 检索，经 RRF（Reciprocal Rank Fusion）融合，实现高精度的语义代码搜索。

## 双通道架构

### Dense 通道（向量检索）

使用 BGE-M3 模型生成 1024 维向量，存储在 SQLite + `sqlite-vec` 中。适合语义相似度查询：

- "用户登录流程" → 匹配 `login`、`authenticate`、`signIn` 等语义相关符号
- "数据校验" → 匹配 `validate`、`checkInput`、`sanitize` 等

### FTS5 通道（全文检索）

使用 SQLite FTS5 全文索引，对符号名、文件路径、摘要文本做关键词检索。适合精确匹配：

- "verifyToken" → 精确命中 `verifyToken` 函数
- "jwt.ts" → 精确命中 `src/auth/jwt.ts` 文件

### RRF 融合

两个通道的结果通过 RRF 算法融合，公式为：

```
score(d) = Σ 1 / (K + rank_i(d))
```

其中 `K` 为 RRF 参数（默认 60），`rank_i(d)` 为文档 `d` 在第 `i` 个通道的排名。

## 降级机制

| 场景 | 行为 |
|------|------|
| 有 API Key + 有向量索引 | Dense + FTS5 双通道 RRF 融合 |
| 无 API Key / 无向量索引 | 自动降级为仅 FTS5 通道 |
| `--no-llm` 构建 | 跳过向量化，检索时走 FTS5 |

降级后仍然可用，只是丢失了语义匹配能力。

## 图谱展开

检索结果不仅返回命中的符号，还会沿图谱边展开，补充上下文：

- **callers**：谁调用了这个函数？
- **callees**：这个函数调用了谁？
- **关联资源**：挂载的 PRD / DB Schema 中哪些条目与之相关？

展开深度由 `graphHops` 控制（默认 2 跳）。

## 独立资源检索

除了通过代码文件间接关联召回 PRD / DB Schema 资源外，IGraph 还支持**独立资源检索通道**：

- 直接对 `resource_vectors` 做 KNN 向量搜索
- 同时对 resources 表做关键词子串匹配
- 两通道结果按 `resourceId` 去重合并

这意味着即使一个 PRD 没有关联到任何代码文件（例如全新需求，尚无对应代码实现），只要语义或关键词与查询匹配，也能被 `igraph_explore` 召回。

独立资源召回数量由 `resourceTopK` 控制（默认 3）。

## 配置

```json
{
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
  }
}
```

| 字段 | 说明 |
|------|------|
| `nodeTopK` | 符号级检索返回数量 |
| `fileTopK` | 文件级检索返回数量 |
| `graphHops` | 图谱展开跳数（0 = 不展开） |
| `rrfK` | RRF 参数，越大排名越平滑 |
| `denseWeight` / `ftsWeight` | 通道权重，可调节偏好 |
| `resourceTopK` | 独立资源检索返回数量（直接搜索 resource_vectors） |
