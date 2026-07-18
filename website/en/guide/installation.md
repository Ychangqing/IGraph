# Installation

## Requirements

- **Node.js >= 18**
- IGraph depends on `better-sqlite3` and tree-sitter **native add-ons** that are compiled during installation. Make sure you have a C/C++ build toolchain:

| Platform | Required |
|----------|----------|
| macOS | Xcode Command Line Tools (`xcode-select --install`) |
| Linux | `build-essential`, `python3` |
| Windows | `windows-build-tools` or Visual Studio Build Tools |

## Global Installation

Install globally for the `igraph` command:

```bash
npm install -g igraph-cli
```

## Local Installation

Or install as a local dependency in your project:

```bash
npm install igraph-cli
```

After installation, run `igraph --version` to verify.

## Global Options

All commands support these global options:

| Option | Description |
|--------|-------------|
| `-v, --verbose` | Print debug logs |
| `-q, --quiet` | Print errors only |
| `-V, --version` | Print version |
