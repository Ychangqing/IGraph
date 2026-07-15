# 多模态挂载

IGraph 支持将 PRD 文档和 DB Schema 等外部资源挂载到代码图谱中，按语义相似度建立**跨模态关联**。

## 什么是多模态挂载？

代码不是孤立存在的。需求文档描述了代码应该做什么，数据库 Schema 描述了代码操作的数据结构。IGraph 将这些外部资源与代码符号关联起来，让 AI 助手在理解代码时能同时看到相关的需求和数据模型。

## 支持的资源类型

### PRD 文档

| 格式 | 扩展名 |
|------|--------|
| Markdown | `.md` `.markdown` |
| 纯文本 | `.txt` |
| PDF | `.pdf` |
| Word | `.docx` |

```bash
igraph mount prd docs/需求文档.md
igraph mount prd specs/PRD.pdf
```

### DB Schema

| 格式 | 扩展名 |
|------|--------|
| SQL DDL | `.sql` `.ddl` |
| JSON Schema | `.json` |
| Excel | `.xlsx` |

```bash
igraph mount db schema/create_tables.sql
igraph mount db schema/er-model.json
```

## 关联机制

挂载时，IGraph 会：

1. 解析资源内容，提取语义片段
2. 对每个片段生成向量
3. 与已有的代码符号做相似度匹配
4. 根据阈值建立关联边

关联分为两级：

| 级别 | 阈值 | 说明 |
|------|------|------|
| 强关联 | ≥ 0.85 | 高置信度匹配，直接建立 `describes` / `reads` 边 |
| 弱关联 | ≥ 0.70 | 可选由 LLM 二次确认后建立 |

## 配置

```json
{
  "multimodal": {
    "strongLinkThreshold": 0.85,
    "weakLinkThreshold": 0.7,
    "llmConfirmWeakLinks": false
  }
}
```

| 字段 | 说明 |
|------|------|
| `strongLinkThreshold` | 强关联阈值（≥ 此值直接关联） |
| `weakLinkThreshold` | 弱关联阈值（在此值和强关联之间的匹配可选确认） |
| `llmConfirmWeakLinks` | 是否使用 LLM 确认弱关联（增加准确性但消耗 token） |

## 查看挂载状态

```bash
igraph status
```

输出中会列出已挂载的资源及其关联数量。

## 无代码关联的资源也能被检索

当 PRD 描述的是全新需求（尚无对应代码实现）时，挂载过程中不会建立 `resource_edges` 关联边——因为没有匹配度达到阈值的代码文件。

但这不影响检索：`igraph_explore` 内置了**独立资源检索通道**，会直接搜索已存储的资源向量和文本，确保新需求 PRD 不被遗漏。

详见 [向量检索 — 独立资源检索](/features/retrieval#独立资源检索)。
