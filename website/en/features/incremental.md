# Incremental Build

IGraph implements incremental builds based on **SHA-256 diff**, dramatically reducing rebuild times.

## How It Works

On each build, IGraph records the SHA-256 hash of every file. On subsequent `build` runs, only changed files are processed:

```bash
# First build (full)
igraph build
# ✓ Parsed 142 files, generated 856 symbol nodes

# After modifying 3 files (incremental)
igraph build
# ✓ Detected 3 changed files, incrementally updated 18 nodes
```

## Cascading Updates

Incremental builds don't just update the changed files — they cascade updates to affected dependencies:

1. **File changed** → Re-parse the file's symbols
2. **Symbol changed** → Update the symbol's call relationship edges
3. **Relationship changed** → Re-generate summaries for affected symbols
4. **Summary changed** → Re-vectorize affected nodes

This ensures the graph stays consistent with source code.

## Forcing a Full Rebuild

If you need to rebuild from scratch (e.g., after switching LLM models or modifying parser config), use `rebuild`:

```bash
igraph rebuild            # Clear database and rebuild from scratch
igraph rebuild --no-llm   # Full rebuild with heuristic fallback
igraph rebuild --dry-run  # Preview only, no execution
```

## Build Options

| Command | Behavior |
|---------|----------|
| `igraph build` | Auto-incremental (full on first run) |
| `igraph build --incremental` | Explicit incremental mode |
| `igraph build --dry-run` | Preview parse stats without writing to DB |
| `igraph build --no-llm` | Skip LLM summaries and vectorization |
| `igraph rebuild` | Clear and full rebuild |
| `igraph rebuild --full` | Same as `rebuild` (default behavior) |
