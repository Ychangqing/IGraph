# MCP Tool 详解

本页面说明 `igraph serve` 通过 MCP（Model Context Protocol）stdio 传输暴露的 4 个只读检索 Tool。

## 前置条件

调用任何 Tool 前，目标仓库需已构建图谱：

```bash
igraph init          # 生成 .igraph/config.json
igraph build         # 解析 → 落库 → 摘要 → 向量化
```

## Tool 概览

| Tool 名 | 用途 |
|---------|------|
| `igraph_explore` | 自然语言检索代码，附带图谱上下文展开 |
| `igraph_node` | 按符号名获取节点详情（源码 + 调用者/被调用者） |
| `igraph_file` | 按文件路径获取文件图谱信息 |
| `igraph_related` | 展开某符号的关联资源（callers/callees/both） |

所有 Tool 均为只读，不修改数据库。无 `IGRAPH_API_KEY` 时 `igraph_explore` 自动降级为仅 FTS5 通道检索。

---

## igraph_explore

自然语言检索代码知识图谱：返回最相关的符号（函数/类/组件/Hook/类型），并附带图谱展开的上下文。

### 输入参数

| 参数 | 类型 | 必填 | 默认 | 约束 | 说明 |
|------|------|------|------|------|------|
| `query` | string | 是 | — | 长度 ≤ 2000 | 自然语言查询 |
| `topK` | integer | 否 | 5 | 1 ~ 50 | 返回结果数 |
| `hops` | integer | 否 | 2 | 0 ~ 5 | 图谱展开跳数 |

### 返回结构

```jsonc
{
  "tool": "igraph_explore",
  "query": "谁负责用户鉴权",
  "degraded": false,           // 是否降级
  "note": "……",               // 仅降级时出现
  "result": {
    /* FormattedResult：命中符号 + 图谱邻居 + 关联资源 */
  }
}
```

`result.resources` 数组中的每条资源包含 `linkType` 字段：
- `"strong"` / `"weak"`：通过代码文件关联（resource_edges）间接召回
- `"direct"`：通过独立资源检索通道直接命中（即使该资源没有关联到任何代码文件）

### 调用示例

```json
{
  "name": "igraph_explore",
  "arguments": {
    "query": "JWT 校验在哪里实现",
    "topK": 5,
    "hops": 2
  }
}
```

---

## igraph_node

按符号名获取节点详情：源码、签名、位置、摘要，以及调用者（callers）与被调用者（callees）。

### 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 符号名（函数/类/组件等） |
| `file` | string | 否 | 文件路径过滤（用于同名消歧） |

### 返回结构

```jsonc
{
  "tool": "igraph_node",
  "name": "verifyToken",
  "found": true,
  "ambiguous": false,
  "detail": {
    "nodeId": 12,
    "name": "verifyToken",
    "kind": "function",
    "filePath": "src/auth/jwt.ts",
    "signature": "…",
    "startLine": 10,
    "endLine": 30,
    "summary": "…",
    "sourceCode": "…",
    "callers": [ /* NodeBrief[] */ ],
    "callees": [ /* NodeBrief[] */ ]
  },
  "candidates": [ /* NodeBrief[]，同名候选供消歧 */ ]
}
```

### 调用示例

```json
{
  "name": "igraph_node",
  "arguments": {
    "name": "verifyToken",
    "file": "src/auth/jwt.ts"
  }
}
```

---

## igraph_file

按文件路径获取文件图谱信息：文件摘要、语言、导出符号及文件内全部节点。

### 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径（相对仓库根） |

### 返回结构

```jsonc
{
  "tool": "igraph_file",
  "path": "src/auth/jwt.ts",
  "found": true,
  "info": {
    "fileId": 3,
    "filePath": "src/auth/jwt.ts",
    "language": "typescript",
    "summary": "…",
    "exportedSymbols": [ /* NodeBrief[] */ ],
    "nodes": [ /* NodeBrief[]，文件内全部节点 */ ]
  }
}
```

### 调用示例

```json
{
  "name": "igraph_file",
  "arguments": {
    "path": "src/auth/jwt.ts"
  }
}
```

---

## igraph_related

展开某符号的关联资源。

### 输入参数

| 参数 | 类型 | 必填 | 默认 | 约束 | 说明 |
|------|------|------|------|------|------|
| `name` | string | 是 | — | — | 符号名 |
| `direction` | string | 否 | `both` | `callers` / `callees` / `both` | 展开方向 |

### 返回结构

```jsonc
{
  "tool": "igraph_related",
  "name": "verifyToken",
  "direction": "both",
  "found": true,
  "seeds": [ /* NodeBrief[]，命中的同名种子节点 */ ],
  "neighbors": [ /* (NodeBrief & { depth })[]，图谱邻居 */ ],
  "resources": [ /* FormattedResource[]，关联的 PRD / DB 资源 */ ]
}
```

### 调用示例

```json
{
  "name": "igraph_related",
  "arguments": {
    "name": "verifyToken",
    "direction": "callers"
  }
}
```

---

## NodeBrief 结构

多个 Tool 的结果字段引用了 `NodeBrief` 符号简要视图：

```jsonc
{
  "nodeId": 12,
  "name": "verifyToken",
  "kind": "function",       // function / class / variable 等
  "filePath": "src/auth/jwt.ts",
  "startLine": 10,
  "endLine": 30
}
```

## 错误处理

- **参数校验失败**（缺少必填、类型错误、超出范围）：返回 `isError: true` 的 text content，内容为中文错误说明
- **未命中**（如 `igraph_node` 查无符号）：正常返回 `found: false`，不视为错误
