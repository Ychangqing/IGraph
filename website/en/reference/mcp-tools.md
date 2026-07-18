# MCP Tools Reference

This page documents the 4 read-only retrieval tools exposed by `igraph serve` via MCP (Model Context Protocol) stdio transport.

## Prerequisites

Before calling any tool, the target repository must have a built graph:

```bash
igraph init          # Generate .igraph/config.json
igraph build         # Parse → store → summarize → vectorize
```

## Tool Overview

| Tool Name | Purpose |
|-----------|---------|
| `igraph_explore` | Natural language code retrieval with graph context expansion |
| `igraph_node` | Get node details by symbol name (source + callers/callees) |
| `igraph_file` | Get file graph info by file path |
| `igraph_related` | Expand a symbol's related resources (callers/callees/both) |

All tools are read-only and do not modify the database. Without `IGRAPH_API_KEY`, `igraph_explore` automatically falls back to FTS5-only retrieval.

---

## igraph_explore

Natural language retrieval against the code knowledge graph: returns the most relevant symbols (functions/classes/components/hooks/types) with graph-expanded context.

### Input Parameters

| Parameter | Type | Required | Default | Constraint | Description |
|-----------|------|----------|---------|------------|-------------|
| `query` | string | Yes | — | Length ≤ 2000 | Natural language query |
| `topK` | integer | No | 5 | 1 ~ 50 | Number of results |
| `hops` | integer | No | 2 | 0 ~ 5 | Graph expansion hops |

### Response Structure

```jsonc
{
  "tool": "igraph_explore",
  "query": "who handles user authentication",
  "degraded": false,           // Whether fallback was used
  "note": "…",               // Only present when degraded
  "result": {
    /* FormattedResult: matched symbols + graph neighbors + related resources */
  }
}
```

Each resource in `result.resources` includes a `linkType` field:
- `"strong"` / `"weak"`: Retrieved through code file associations (resource_edges)
- `"direct"`: Retrieved through the independent resource retrieval channel (even if the resource has no code file associations)

### Example Call

```json
{
  "name": "igraph_explore",
  "arguments": {
    "query": "where is JWT validation implemented",
    "topK": 5,
    "hops": 2
  }
}
```

---

## igraph_node

Get node details by symbol name: source code, signature, location, summary, callers, and callees.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Symbol name (function/class/component, etc.) |
| `file` | string | No | File path filter (for disambiguation) |

### Response Structure

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
  "candidates": [ /* NodeBrief[], same-name candidates for disambiguation */ ]
}
```

### Example Call

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

Get file graph info by file path: file summary, language, exported symbols, and all nodes in the file.

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | File path (relative to repository root) |

### Response Structure

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
    "nodes": [ /* NodeBrief[], all nodes in the file */ ]
  }
}
```

### Example Call

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

Expand a symbol's related resources.

### Input Parameters

| Parameter | Type | Required | Default | Constraint | Description |
|-----------|------|----------|---------|------------|-------------|
| `name` | string | Yes | — | — | Symbol name |
| `direction` | string | No | `both` | `callers` / `callees` / `both` | Expansion direction |

### Response Structure

```jsonc
{
  "tool": "igraph_related",
  "name": "verifyToken",
  "direction": "both",
  "found": true,
  "seeds": [ /* NodeBrief[], matched same-name seed nodes */ ],
  "neighbors": [ /* (NodeBrief & { depth })[], graph neighbors */ ],
  "resources": [ /* FormattedResource[], associated PRD / DB resources */ ]
}
```

### Example Call

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

## NodeBrief Structure

Multiple tool results reference the `NodeBrief` symbol brief view:

```jsonc
{
  "nodeId": 12,
  "name": "verifyToken",
  "kind": "function",       // function / class / variable etc.
  "filePath": "src/auth/jwt.ts",
  "startLine": 10,
  "endLine": 30
}
```

## Error Handling

- **Parameter validation failure** (missing required, wrong type, out of range): Returns `isError: true` text content with an error description
- **Not found** (e.g., `igraph_node` finds no symbol): Returns `found: false` normally, not treated as an error
