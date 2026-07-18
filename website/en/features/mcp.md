# MCP Integration

IGraph includes a built-in MCP (Model Context Protocol) Server that integrates directly with Cursor, Claude Code, and other AI assistants, allowing AI to query the code knowledge graph while coding.

## What Is MCP?

MCP is a standardized protocol that allows AI assistants to call external tools. IGraph's MCP Server exposes 4 read-only retrieval tools via **stdio transport**, enabling AI assistants to query the graph with natural language.

## Quick Setup

### Auto-Registration (Recommended)

One command to complete setup:

```bash
igraph register
```

`register` auto-detects installed AI assistants and writes their configs. Supported targets:

| Assistant | Project Config | Global Config |
|-----------|---------------|---------------|
| Claude Code | `.mcp.json` | `~/.claude.json` |
| Cursor | `.cursor/mcp.json` | `~/.cursor/mcp.json` |

More options:

```bash
igraph register --target claude      # Register with Claude Code only
igraph register --target cursor      # Register with Cursor only
igraph register --global             # Write to global config
igraph unregister                    # Unregister
```

### Manual Configuration

Add to your AI assistant's MCP config file:

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

`IGRAPH_API_KEY` is inherited from the user's shell environment — no need to specify it in config.

## Exposed MCP Tools

| Tool | Description |
|------|-------------|
| `igraph_explore` | Natural language retrieval with graph context expansion |
| `igraph_node` | Get node details by symbol name (source + callers/callees) |
| `igraph_file` | Get file graph info by file path |
| `igraph_related` | Expand a symbol's related resources |

All tools are **read-only** and do not modify the database.

See [MCP Tools Reference](/en/reference/mcp-tools) for detailed parameters, return structures, and usage examples.

## Fallback Behavior

| Scenario | `igraph_explore` Behavior |
|----------|--------------------------|
| Has API Key + vectors | Dense + FTS5 dual-channel RRF fusion |
| No API Key | Automatic fallback to FTS5-only retrieval |

The other three tools (`igraph_node`, `igraph_file`, `igraph_related`) don't depend on vectors and always work.

## Notes

- MCP stdio protocol uses stdout exclusively for JSON-RPC frames; IGraph diagnostic logs go to stderr
- `igraph serve` uses the current working directory as the repository root
- Ensure `.igraph/igraph.db` exists in the current directory (i.e., you've run `igraph build`)
