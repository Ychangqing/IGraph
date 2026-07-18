# Configuration

## Config File

`igraph init` generates `.igraph/config.json` in the current directory. The graph database is stored at `.igraph/igraph.db`.

The config file has five sections:

```jsonc
{
  "embedding": { ... },    // Vectorization settings
  "llm": { ... },          // LLM summary settings
  "parser": { ... },       // Parser settings
  "retrieval": { ... },    // Retrieval settings
  "multimodal": { ... }    // Multimodal association settings
}
```

## embedding — Vectorization

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `baseURL` | string | `http://localhost:8080/v1` | Embedding API endpoint |
| `model` | string | `bge-m3` | Embedding model name |
| `dimensions` | number | `1024` | Vector dimensions |
| `batchSize` | number | `32` | Batch embedding size |

## llm — LLM Summaries

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `baseURL` | string | `https://api.openai.com/v1` | LLM API endpoint |
| `model` | string | `gpt-4o-mini` | Symbol summary model |
| `fileSummaryModel` | string | `gpt-4o` | File summary model |
| `temperature` | number | `0` | Generation temperature |
| `maxConcurrency` | number | `5` | Max concurrent requests |
| `promptVersion` | string | `v1.0` | Prompt version identifier |

## parser — Parser

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `languages` | string[] | `["typescript", "javascript"]` | Enabled languages |
| `include` | string[] | `["**/*"]` | File include globs |
| `exclude` | string[] | See below | File exclude globs |

Default exclude patterns:

```json
["node_modules/**", "dist/**", "**/*.test.*", "**/*.spec.*", "**/*.d.ts"]
```

## retrieval — Retrieval

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fileTopK` | number | `10` | File-level retrieval count |
| `nodeTopK` | number | `10` | Symbol-level retrieval count |
| `fallbackThreshold` | number | `0.75` | Fallback threshold |
| `graphHops` | number | `2` | Graph expansion hops |
| `fusion` | string | `rrf` | Fusion strategy |
| `rrfK` | number | `60` | RRF fusion parameter |
| `denseWeight` | number | `1.0` | Dense channel weight |
| `ftsWeight` | number | `1.0` | FTS5 channel weight |
| `resourceTopK` | number | `3` | Independent resource retrieval count (searches resource_vectors directly) |

## multimodal — Multimodal Association

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `strongLinkThreshold` | number | `0.85` | Strong association threshold |
| `weakLinkThreshold` | number | `0.7` | Weak association threshold |
| `llmConfirmWeakLinks` | boolean | `false` | Use LLM to confirm weak associations |

## Credential Management

::: danger Security Constraint
API Keys and other sensitive data **must never** be written to project-level config files (to prevent committing to git). Config validation actively scans for and rejects configs containing credential fields.
:::

### Recommended — Global Config

Use `igraph config set` once, shared across all projects:

```bash
igraph config set apiKey sk-xxx
igraph config set embedding.baseURL http://my-embedding:8080/v1
igraph config set llm.baseURL https://api.openai.com/v1
```

Global config is stored at `~/.igraph/config.json`. View with `igraph config list`.

### Environment Variables (Highest Priority)

| Variable | Description | Required |
|----------|-------------|----------|
| `IGRAPH_API_KEY` | Shared key for LLM / Embedding | Required for online commands |
| `IGRAPH_EMBEDDING_BASE_URL` | Overrides `embedding.baseURL` | Optional |
| `IGRAPH_LLM_BASE_URL` | Overrides `llm.baseURL` | Optional |

### Priority

**Environment variables > Global config (`~/.igraph/config.json`) > Project config (`.igraph/config.json`)**

```bash
# Environment variable (temporary override)
export IGRAPH_API_KEY="sk-..."
```

Without an API Key:
- `build` / `rebuild` can run with `--no-llm` for heuristic fallback
- `query` / `eval` / `serve` automatically fall back to FTS5-only retrieval
