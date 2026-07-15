<p align="center">
  <img src="website/public/logo.svg" width="120" alt="IGraph Logo" />
</p>

<h1 align="center">IGraph</h1>

<p align="center">
  Code knowledge graph builder — Parsing → Semantics → Vectorization
</p>

<p align="center">
  <a href="README.md">简体中文</a> · English
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/igraph-cli"><img src="https://img.shields.io/npm/v/igraph-cli?color=blue&label=npm" alt="npm version" /></a>
  <a href="https://github.com/Ychangqing/IGraph/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Ychangqing/IGraph" alt="license" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node version" /></a>
  <a href="https://github.com/Ychangqing/IGraph/actions"><img src="https://img.shields.io/github/actions/workflow/status/Ychangqing/IGraph/deploy-docs.yml?label=docs" alt="docs build" /></a>
  <a href="https://github.com/Ychangqing/IGraph/issues"><img src="https://img.shields.io/github/issues/Ychangqing/IGraph" alt="issues" /></a>
</p>

<p align="center">
  <a href="https://ychangqing.github.io/IGraph/">Documentation</a> ·
  <a href="https://ychangqing.github.io/IGraph/guide/quick-start">Quick Start</a> ·
  <a href="https://ychangqing.github.io/IGraph/reference/cli">CLI Reference</a> ·
  <a href="https://ychangqing.github.io/IGraph/features/mcp">MCP Integration</a>
</p>

---

## 🎯 Introduction

IGraph parses a code repository into a knowledge graph made of symbol nodes and call-relation edges. It enriches that graph with LLM-generated semantic summaries and vector indexes, then serves retrieval through dual-channel RRF fusion across dense vectors and FTS5 full-text search. It can also mount multimodal resources such as PRDs and DB schemas to build cross-modal associations, and includes an MCP Server that connects directly to AI assistants such as Cursor and Claude Code.

## ✨ Core Capabilities

| Capability | Description |
|------------|-------------|
| 🌳 Multi-language parsing | A tree-sitter powered 5-pass pipeline supporting TypeScript, JavaScript, Python, Go, and Java |
| 🧠 Semantic summaries | Uses an LLM to summarize files and symbols, with heuristic fallback when `--no-llm` is enabled |
| 🔍 Dual-channel retrieval | BGE-M3 vectors plus FTS5 full-text search, fused through RRF |
| 📎 Multimodal mounting | Builds cross-modal links for PRD documents and DB schemas based on semantic similarity |
| ⚡ Incremental builds | Cascading updates based on SHA-256 diffs, rebuilding only affected files |
| 🤖 MCP integration | Connects to Cursor and Claude Code with a single command |

## 📦 Installation

**Requirements:** Node.js >= 18 and a C/C++ build toolchain for native dependencies.

```bash
# Install globally
npm install -g igraph-cli

# Or install locally in a project
npm install igraph-cli
```

<details>
<summary>Build toolchain setup</summary>

- **macOS:** `xcode-select --install`
- **Linux:** `sudo apt install build-essential python3`
- **Windows:** Visual Studio Build Tools

</details>

## 🚀 Quick Start

```bash
# 1. Initialize
igraph init

# 2. Add credentials (global config shared by all projects)
igraph config set apiKey sk-...

# 3. Build the graph
igraph build

# 4. Register the MCP Server with an AI assistant
igraph register

# 5. Query in natural language
igraph query "Where is user authentication implemented?"
```

> If no API key is available, run `igraph build --no-llm` to use heuristic fallback. `query` and `serve` will automatically fall back to FTS5-only retrieval.

For more usage details, see the [documentation](https://ychangqing.github.io/IGraph/guide/quick-start).

## 🤖 MCP Integration

```bash
# Automatically detect installed AI assistants and register
igraph register

# Specify a target
igraph register --target claude
igraph register --target cursor

# Unregister
igraph unregister
```

After registration, AI assistants can directly call four read-only retrieval tools:

| Tool | Description |
|------|-------------|
| `igraph_explore` | Natural-language retrieval with expanded graph context |
| `igraph_node` | Get node details by symbol name |
| `igraph_file` | Get graph information by file path |
| `igraph_related` | Expand related resources for a symbol |

See the [MCP Tool documentation](https://ychangqing.github.io/IGraph/reference/mcp-tools) for details.

## 📋 Command Cheat Sheet

| Command | Description |
|---------|-------------|
| `igraph init` | Initialize configuration |
| `igraph build` | Build the graph with automatic incremental updates |
| `igraph rebuild` | Clear data and rebuild from scratch |
| `igraph status` | Show graph status |
| `igraph query` | Run natural-language retrieval |
| `igraph eval` | Evaluate retrieval quality |
| `igraph serve` | Start the MCP Server |
| `igraph register` | Register with an AI assistant |
| `igraph mount prd` | Mount PRD documents |
| `igraph mount db` | Mount DB schemas |
| `igraph config` | Manage global configuration |

## 🗂 Supported Languages and Formats

| Category | Language / Type | Extensions |
|----------|-----------------|------------|
| Code | TypeScript | `.ts` `.tsx` `.mts` `.cts` |
| Code | JavaScript | `.js` `.jsx` `.mjs` `.cjs` |
| Code | Python | `.py` `.pyi` |
| Code | Go | `.go` |
| Code | Java | `.java` |
| Multimodal | PRD documents | `.md` `.txt` `.pdf` `.docx` |
| Multimodal | DB schemas | `.sql` `.ddl` `.json` `.xlsx` |

## 🛠 Development

```bash
npm run dev        # watch mode
npm test           # vitest
npm run lint       # eslint
npm run typecheck  # type checking
npm run build      # build
```

## 🤝 Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## 📄 License

[MIT](LICENSE) © 2024-present IGraph
