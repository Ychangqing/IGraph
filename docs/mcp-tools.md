# IGraph MCP Tools

本文面向 **AI 助手 / Agent**,说明 `igraph serve` 通过 MCP(Model Context Protocol)stdio 传输暴露的检索工具。

IGraph 将代码仓库解析为知识图谱(符号 + 调用关系 + 多模态资源),并通过 4 个**只读**检索 tool 供支持 MCP 的客户端调用:

| Tool 名           | 用途                                       |
| ----------------- | ------------------------------------------ |
| `igraph_explore`  | 自然语言检索代码,附带图谱上下文展开        |
| `igraph_node`     | 按符号名获取节点详情(源码 + 调用者/被调用者) |
| `igraph_file`     | 按文件路径获取文件图谱信息                  |
| `igraph_related`  | 展开某符号的关联资源(callers/callees/both) |

> 所有 tool 均为只读,不修改数据库。无 `IGRAPH_API_KEY` 时 `igraph_explore` 自动降级为仅 FTS5 通道检索(仍走 RRF 融合),离线可用。

---

## 前置:构建图谱

调用任何 tool 前,目标仓库需已构建图谱(生成 `.igraph/igraph.db`):

```bash
igraph init          # 生成 .igraph/config.json
igraph build         # 解析 → 落库 → 摘要 →(有 API Key 时)向量化
```

`serve` 以当前工作目录为仓库根启动,在包含 `.igraph/` 的目录下运行客户端命令。

---

## 在 MCP 客户端中配置

`igraph serve` 使用 **stdio 传输**,`command` 用 `igraph`,`args` 为 `["serve"]`。

### Cursor / Claude Code

在 MCP 配置文件(如 Cursor 的 `~/.cursor/mcp.json`、Claude Code 的 `.mcp.json`)中加入:

```json
{
  "mcpServers": {
    "igraph": {
      "command": "igraph",
      "args": ["serve"],
      "cwd": "/absolute/path/to/your/repo",
      "env": {
        "IGRAPH_API_KEY": "sk-..."
      }
    }
  }
}
```

- `cwd`:指向已构建图谱(含 `.igraph/`)的仓库根目录。
- `env.IGRAPH_API_KEY`:**可选**。提供后 `igraph_explore` 走 Dense + FTS5 双通道;不提供则自动降级为仅 FTS5 通道。凭据**只经环境变量注入**,禁止写入配置文件。

> 注意:MCP stdio 协议独占 stdout 承载 JSON-RPC 帧,IGraph 的诊断日志一律走 stderr,不会污染协议。

---

## Tool 详解

每个 tool 返回一段 `text` content,内容为 `JSON.stringify` 的结构化结果(带缩进)。

### 1. `igraph_explore`

自然语言检索代码知识图谱:返回最相关的符号(函数/类/组件/Hook/类型),并附带图谱展开的上下文(调用者/被调用者)。适合「这段逻辑在哪实现」「谁负责鉴权」等探索型问题。

**输入参数**

| 参数    | 类型    | 必填 | 默认 | 约束            | 说明                     |
| ------- | ------- | ---- | ---- | --------------- | ------------------------ |
| `query` | string  | 是   | —    | 长度 ≤ 2000     | 自然语言查询             |
| `topK`  | integer | 否   | 5    | 1 ~ 50          | 返回结果数               |
| `hops`  | integer | 否   | 2    | 0 ~ 5           | 图谱展开跳数             |

**返回结构**

```jsonc
{
  "tool": "igraph_explore",
  "query": "谁负责用户鉴权",
  "degraded": false,           // 是否降级(无向量/无 API Key 时为 true)
  "note": "……",               // 仅降级时出现,说明降级原因
  "result": {                  // FormattedResult:命中符号 + 图谱邻居 + 关联资源
    /* 结构化检索结果 */
  }
}
```

**调用示例**

```json
{ "name": "igraph_explore", "arguments": { "query": "JWT 校验在哪里实现", "topK": 5, "hops": 2 } }
```

---

### 2. `igraph_node`

按符号名获取节点详情:源码、签名、位置、摘要,以及调用者(callers)与被调用者(callees)。同名多个时可用 `file` 过滤。

**输入参数**

| 参数   | 类型   | 必填 | 说明                                 |
| ------ | ------ | ---- | -------------------------------------- |
| `name` | string | 是   | 符号名(函数/类/组件等)               |
| `file` | string | 否   | 文件路径过滤(用于同名消歧,支持后缀匹配) |

**返回结构**

```jsonc
{
  "tool": "igraph_node",
  "name": "verifyToken",
  "found": true,
  "ambiguous": false,          // 同名多个时为 true
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
  "candidates": [ /* NodeBrief[],同名候选供消歧 */ ]
}
```

**调用示例**

```json
{ "name": "igraph_node", "arguments": { "name": "verifyToken", "file": "src/auth/jwt.ts" } }
```

---

### 3. `igraph_file`

按文件路径获取文件图谱信息:文件摘要、语言、导出符号,以及该文件内的全部节点列表。

**输入参数**

| 参数   | 类型   | 必填 | 说明                     |
| ------ | ------ | ---- | ------------------------ |
| `path` | string | 是   | 文件路径(相对仓库根)   |

**返回结构**

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
    "nodes": [ /* NodeBrief[],文件内全部节点 */ ]
  }
}
```

**调用示例**

```json
{ "name": "igraph_file", "arguments": { "path": "src/auth/jwt.ts" } }
```

---

### 4. `igraph_related`

展开某符号的关联资源:`direction=callers`(谁调用它)/ `callees`(它调用谁)/ `both`(默认,双向)。返回种子节点、图谱邻居(带深度),以及关联的多模态资源(PRD / DB Schema)。

**输入参数**

| 参数        | 类型   | 必填 | 默认   | 约束                          | 说明         |
| ----------- | ------ | ---- | ------ | ----------------------------- | ------------ |
| `name`      | string | 是   | —      | —                             | 符号名       |
| `direction` | string | 否   | `both` | `callers` / `callees` / `both` | 展开方向     |

**返回结构**

```jsonc
{
  "tool": "igraph_related",
  "name": "verifyToken",
  "direction": "both",
  "found": true,
  "seeds": [ /* NodeBrief[],命中的同名种子节点 */ ],
  "neighbors": [ /* (NodeBrief & { depth })[],图谱邻居 */ ],
  "resources": [ /* FormattedResource[],关联的 PRD / DB 资源 */ ]
}
```

**调用示例**

```json
{ "name": "igraph_related", "arguments": { "name": "verifyToken", "direction": "callers" } }
```

---

## 附:NodeBrief 结构

多个 tool 的结果字段引用了 `NodeBrief` 符号简要视图:

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

- 输入参数校验失败(缺少必填、类型错误、超出范围)或未知 tool 名:返回 `isError: true` 的 text content,内容为人类可读的中文错误说明。
- 未命中(如 `igraph_node` 查无符号、`igraph_file` 路径不存在):正常返回,`found: false`,不视为错误。