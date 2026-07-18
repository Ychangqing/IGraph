# CLI Command Reference

## igraph init

Initialize project configuration.

```bash
igraph init [options]
```

| Option | Description |
|--------|-------------|
| `-f, --force` | Force overwrite existing config file |

Generates `.igraph/config.json` in the current directory. Skips if config already exists; use `--force` to overwrite.

## igraph build

Build the code knowledge graph.

```bash
igraph build [options]
```

| Option | Description |
|--------|-------------|
| `--incremental` | Explicit incremental mode (auto-detected by default) |
| `--dry-run` | Preview parse stats without writing to DB |
| `--no-llm` | Skip LLM summaries and vectorization, use heuristic fallback |

First run performs a full build; subsequent runs auto-increment (based on SHA-256 diff).

## igraph rebuild

Clear database and rebuild from scratch.

```bash
igraph rebuild [options]
```

| Option | Description |
|--------|-------------|
| `--full` | Full rebuild (default behavior) |
| `--dry-run` | Preview only, no deletion or writing |
| `--no-llm` | Heuristic fallback rebuild |

Use when switching LLM models or modifying parser config.

## igraph status

View graph status.

```bash
igraph status
```

Output includes:
- File count, node count, edge count
- Vector index status
- Mounted multimodal resources
- Build progress

## igraph query

Natural language query against the code graph.

```bash
igraph query <question> [options]
```

| Option | Description |
|--------|-------------|
| `--top-k <n>` | Number of results to return (default 5) |
| `--json` | Output results in JSON format |

Examples:

```bash
igraph query "where is user auth implemented"
igraph query "JWT validation" --top-k 10 --json
```

## igraph eval

Evaluate retrieval quality.

```bash
igraph eval [options]
```

| Option | Description |
|--------|-------------|
| `--test-set <path>` | Test set file path |
| `--top-k <n>` | Top-K value for evaluation |

Outputs Recall@K, MRR, and latency metrics.

## igraph serve

Start the MCP Server (stdio transport).

```bash
igraph serve
```

Starts with the current working directory as the repository root, exposing 4 read-only retrieval tools. Usually not invoked directly — called automatically by AI assistants via MCP config.

## igraph register

Register the MCP Server with AI assistant configs.

```bash
igraph register [options]
```

| Option | Description |
|--------|-------------|
| `-t, --target <targets>` | Target assistants (`auto` / `claude` / `cursor`, comma-separated), default `auto` |
| `-g, --global` | Write to global config instead of project-level |

`auto` mode auto-detects installed Claude Code and Cursor.

Examples:

```bash
igraph register                       # Auto-detect and register
igraph register --target claude       # Claude Code only
igraph register --target cursor       # Cursor only
igraph register --global              # Write to global config
```

## igraph unregister

Remove MCP Server registration from AI assistant configs.

```bash
igraph unregister [options]
```

| Option | Description |
|--------|-------------|
| `-t, --target <targets>` | Target assistants (`auto` / `claude` / `cursor`, comma-separated), default `auto` |
| `-g, --global` | Remove from global config |

## igraph mount prd

Mount a PRD document.

```bash
igraph mount prd <path> [options]
```

| Option | Description |
|--------|-------------|
| `--top-k <n>` | Association match count |

Supported formats: `.md` `.txt` `.pdf` `.docx`

## igraph mount db

Mount a DB Schema.

```bash
igraph mount db <path> [options]
```

| Option | Description |
|--------|-------------|
| `--top-k <n>` | Association match count |

Supported formats: `.sql` `.ddl` `.json` `.xlsx`

## igraph config

Manage global configuration (`~/.igraph/config.json`).

### igraph config set

```bash
igraph config set <key> <value>
```

Set a global config value. Supported keys:

| Key | Description | Example |
|-----|-------------|---------|
| `apiKey` | API Key | `igraph config set apiKey sk-xxx` |
| `embeddingBaseURL` | Embedding service URL | `igraph config set embeddingBaseURL http://localhost:8080/v1` |
| `llmBaseURL` | LLM service URL | `igraph config set llmBaseURL https://api.openai.com/v1` |
| `section.field` | Any config field | `igraph config set llm.model gpt-4o-mini` |

### igraph config get

```bash
igraph config get <key>
```

Get a global config value (credentials are masked).

### igraph config list

```bash
igraph config list
```

List all global config values.

### igraph config path

```bash
igraph config path
```

Print the global config file path (`~/.igraph/config.json`).
