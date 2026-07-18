# Semantic Summaries

IGraph generates LLM-powered semantic summaries for files and symbols, so the graph contains not just structural information but also **semantic understanding**.

## How It Works

During the build process, IGraph sends each symbol's source code and context to an LLM to generate concise semantic descriptions. Summaries are stored in the graph database for retrieval and display.

### Symbol Summaries

For each function, class, component, etc., the LLM generates a one-line summary describing its responsibility and behavior:

> `verifyToken` — Validates JWT token authenticity, checks signature and expiration, returns decoded user info

### File Summaries

For each file, a file-level overview is generated based on its exported symbols and internal logic:

> `src/auth/jwt.ts` — JWT authentication module providing token generation, validation, and refresh capabilities

## Heuristic Fallback

When there's no `IGRAPH_API_KEY` or the `--no-llm` flag is used, IGraph automatically switches to heuristic summaries:

```bash
igraph build --no-llm
```

The heuristic approach generates descriptions from symbol names, parameter signatures, and code structure without network access:

> `verifyToken(token: string): Promise<User>` — Accepts a token parameter, returns a Promise of User type

Less precise than LLM summaries, but guarantees offline availability.

## Configuration

In the `llm` section of `.igraph/config.json`:

```json
{
  "llm": {
    "baseURL": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "fileSummaryModel": "gpt-4o",
    "temperature": 0,
    "maxConcurrency": 5,
    "promptVersion": "v1.0"
  }
}
```

| Field | Description |
|-------|-------------|
| `model` | Model for symbol summaries (lightweight, fast) |
| `fileSummaryModel` | Model for file summaries (stronger comprehension) |
| `maxConcurrency` | Concurrent request limit to avoid rate limiting |

::: tip Cost Control
Lightweight models like `gpt-4o-mini` are sufficient for symbol summaries. Use a stronger model for file summaries to get better overviews.
:::
