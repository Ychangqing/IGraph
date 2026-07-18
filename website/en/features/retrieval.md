# Vector Retrieval

IGraph uses a **Dense + FTS5 dual-channel** retrieval system with RRF (Reciprocal Rank Fusion) to achieve high-precision semantic code search.

## Dual-Channel Architecture

### Dense Channel (Vector Retrieval)

Uses the BGE-M3 model to generate 1024-dimensional vectors stored in SQLite + `sqlite-vec`. Best for semantic similarity queries:

- "user login flow" → matches `login`, `authenticate`, `signIn` and other semantically related symbols
- "data validation" → matches `validate`, `checkInput`, `sanitize`, etc.

### FTS5 Channel (Full-Text Search)

Uses SQLite FTS5 full-text indexing on symbol names, file paths, and summary text. Best for exact matching:

- "verifyToken" → exact match on the `verifyToken` function
- "jwt.ts" → exact match on `src/auth/jwt.ts`

### RRF Fusion

Results from both channels are fused using the RRF algorithm:

```
score(d) = Σ 1 / (K + rank_i(d))
```

Where `K` is the RRF parameter (default 60) and `rank_i(d)` is the rank of document `d` in channel `i`.

## Fallback Behavior

| Scenario | Behavior |
|----------|----------|
| Has API Key + vector index | Dense + FTS5 dual-channel RRF fusion |
| No API Key / no vector index | Automatic fallback to FTS5-only |
| Built with `--no-llm` | Skips vectorization, retrieval uses FTS5 |

Still functional after fallback, just without semantic matching.

## Graph Expansion

Search results don't just return matched symbols — they also expand along graph edges to provide context:

- **callers**: Who calls this function?
- **callees**: What does this function call?
- **related resources**: Which mounted PRD / DB Schema entries are related?

Expansion depth is controlled by `graphHops` (default 2 hops).

## Independent Resource Retrieval

In addition to retrieving PRD / DB Schema resources through code file associations, IGraph supports an **independent resource retrieval channel**:

- Direct KNN vector search on `resource_vectors`
- Keyword substring matching on the resources table
- Results from both channels are deduplicated by `resourceId`

This means even if a PRD has no associated code files (e.g., a new requirement with no implementation yet), it can still be retrieved by `igraph_explore` as long as it semantically or keyword-matches the query.

Independent resource retrieval count is controlled by `resourceTopK` (default 3).

## Configuration

```json
{
  "retrieval": {
    "fileTopK": 10,
    "nodeTopK": 10,
    "fallbackThreshold": 0.75,
    "graphHops": 2,
    "fusion": "rrf",
    "rrfK": 60,
    "denseWeight": 1.0,
    "ftsWeight": 1.0,
    "resourceTopK": 3
  }
}
```

| Field | Description |
|-------|-------------|
| `nodeTopK` | Symbol-level retrieval count |
| `fileTopK` | File-level retrieval count |
| `graphHops` | Graph expansion hops (0 = no expansion) |
| `rrfK` | RRF parameter; higher = smoother ranking |
| `denseWeight` / `ftsWeight` | Channel weights for tuning preference |
| `resourceTopK` | Independent resource retrieval count (searches resource_vectors directly) |
