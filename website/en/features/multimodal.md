# Multimodal Mounting

IGraph supports mounting PRD documents and DB schemas as external resources into the code graph, establishing **cross-modal associations** based on semantic similarity.

## What Is Multimodal Mounting?

Code doesn't exist in isolation. Requirements documents describe what code should do; database schemas describe the data structures code operates on. IGraph links these external resources to code symbols, so AI assistants can see relevant requirements and data models while understanding code.

## Supported Resource Types

### PRD Documents

| Format | Extensions |
|--------|-----------|
| Markdown | `.md` `.markdown` |
| Plain text | `.txt` |
| PDF | `.pdf` |
| Word | `.docx` |

```bash
igraph mount prd docs/requirements.md
igraph mount prd specs/PRD.pdf
```

### DB Schema

| Format | Extensions |
|--------|-----------|
| SQL DDL | `.sql` `.ddl` |
| JSON Schema | `.json` |
| Excel | `.xlsx` |

```bash
igraph mount db schema/create_tables.sql
igraph mount db schema/er-model.json
```

## Association Mechanism

When mounting, IGraph:

1. Parses resource content and extracts semantic fragments
2. Generates vectors for each fragment
3. Computes similarity against existing code symbols
4. Establishes association edges based on thresholds

Associations have two levels:

| Level | Threshold | Description |
|-------|-----------|-------------|
| Strong | ≥ 0.85 | High-confidence match; directly creates `describes` / `reads` edges |
| Weak | ≥ 0.70 | Optionally confirmed by LLM before creating edges |

## Configuration

```json
{
  "multimodal": {
    "strongLinkThreshold": 0.85,
    "weakLinkThreshold": 0.7,
    "llmConfirmWeakLinks": false
  }
}
```

| Field | Description |
|-------|-------------|
| `strongLinkThreshold` | Strong association threshold (≥ this value = direct link) |
| `weakLinkThreshold` | Weak association threshold (between this and strong = optional confirmation) |
| `llmConfirmWeakLinks` | Whether to use LLM to confirm weak associations (improves accuracy but costs tokens) |

## Check Mount Status

```bash
igraph status
```

The output lists mounted resources and their association counts.

## Resources Without Code Associations Are Still Retrievable

When a PRD describes a brand-new requirement (no corresponding code implementation yet), no `resource_edges` are created during mounting — because no code files reach the similarity threshold.

This doesn't affect retrieval: `igraph_explore` has a built-in **independent resource retrieval channel** that directly searches stored resource vectors and text, ensuring new PRDs aren't missed.

See [Vector Retrieval — Independent Resource Retrieval](/en/features/retrieval#independent-resource-retrieval).
