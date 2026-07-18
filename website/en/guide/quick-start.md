# Quick Start

This page walks through the full workflow from initialization to AI assistant integration.

## 1. Initialize Configuration

Run in your project root:

```bash
igraph init
```

This generates `.igraph/config.json` with default settings for the parser, LLM, vectorization, etc.

## 2. Provide Credentials

### Option A: Global config (recommended — set once, shared across projects)

```bash
igraph config set apiKey sk-xxx
```

### Option B: Environment variable (temporary override or CI)

```bash
export IGRAPH_API_KEY="sk-..."
```

::: tip Works without an API Key
Add `--no-llm` to skip LLM summaries and vectorization, using heuristic fallback. Retrieval automatically falls back to FTS5-only.
:::

## 3. Build the Graph

```bash
igraph build
```

The first run performs a full build: parse → store → summarize → vectorize.

Common variants:

```bash
igraph build --no-llm    # Heuristic fallback (no API Key needed)
igraph build --dry-run   # Preview parse stats without writing to DB
```

## 4. Mount External Resources (Optional)

Mount PRD documents or DB schemas to establish cross-modal associations:

```bash
igraph mount prd docs/requirements.md
igraph mount db  schema/db.sql
```

## 5. Verify Retrieval

Query the graph with natural language to verify the build:

```bash
igraph query "where is user authentication implemented"
igraph query "JWT validation" --top-k 5 --json
```

## 6. Check Graph Status

```bash
igraph status
```

Outputs graph scale (files/nodes/edges), vector index status, mounted resources, etc.

## 7. Register with AI Assistants

Register the MCP Server with your installed AI assistants in one command:

```bash
igraph register
```

`register` auto-detects Claude Code and Cursor and writes the MCP config. You can also specify targets:

```bash
igraph register --target claude
igraph register --target cursor
igraph register --global        # Global config (shared across projects)
```

## 8. Manual MCP Server Start (Alternative)

If you prefer not to use `register`, start manually:

```bash
igraph serve
```

Then add the entry to your AI assistant's MCP config file manually. See [MCP Integration](/en/features/mcp).

## Incremental Updates

After the first `build`, subsequent runs **automatically do incremental updates** (based on file SHA-256 diff):

```bash
igraph build    # Auto-detects changes, rebuilds affected files only
```

For a full rebuild:

```bash
igraph rebuild            # Clear and rebuild from scratch
igraph rebuild --no-llm   # Heuristic fallback rebuild
```

## Next Steps

- [Configuration](/en/guide/configuration) — Full configuration reference
- [Core Features](/en/features/parsing) — Deep dive into each capability
- [CLI Reference](/en/reference/cli) — All commands and options
