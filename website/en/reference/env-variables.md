# Environment Variables

IGraph follows a **zero-hardcoded-credentials** principle — all sensitive information can only be injected via environment variables.

## Variable List

| Variable | Description | Required |
|----------|-------------|----------|
| `IGRAPH_API_KEY` | Shared key for LLM / Embedding | Required for online commands (LLM summary / vectorization) |
| `IGRAPH_EMBEDDING_BASE_URL` | Overrides `embedding.baseURL` config | Optional |
| `IGRAPH_LLM_BASE_URL` | Overrides `llm.baseURL` config | Optional |

## Priority

**Environment variables > Project config file**

When both an environment variable and a config file value exist, the environment variable takes precedence.

## Setting Up

### Temporary (Current Terminal Session)

```bash
export IGRAPH_API_KEY="sk-..."
export IGRAPH_EMBEDDING_BASE_URL="http://localhost:8080/v1"
```

### Persistent

Add environment variables to your shell config file:

```bash
# ~/.bashrc or ~/.zshrc
export IGRAPH_API_KEY="sk-..."
```

::: warning
**Never** write API Keys to:
- `.igraph/config.json` config files
- Any file in the code repository
- MCP config files (`.mcp.json`, etc.)

IGraph actively scans for and rejects configs containing credential fields.
:::

## Behavior Without API Key

| Command | Behavior |
|---------|----------|
| `igraph build` | Add `--no-llm` to run (skips summary and vectorization) |
| `igraph rebuild` | Add `--no-llm` to run |
| `igraph query` | Automatic fallback to FTS5-only full-text search |
| `igraph eval` | Automatic fallback to FTS5-only full-text search |
| `igraph serve` | MCP Server starts normally; `igraph_explore` falls back to FTS5-only |
| `igraph init` | No API Key needed |
| `igraph status` | No API Key needed |
| `igraph register` | No API Key needed |

## Credential Passing in MCP Server

When using `igraph register`, **no** `env` field is written to the MCP config. The API Key is inherited from the user's shell environment.

This means:
- Ensure you've run `export IGRAPH_API_KEY` in your terminal before starting the AI assistant
- Or add it to your shell config file for persistence
