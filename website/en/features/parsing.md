# Multi-Language Parsing

IGraph uses a [tree-sitter](https://tree-sitter.github.io/)-powered 5-pass pipeline to parse source code into structured symbol nodes and relationship edges.

## Supported Languages

| Language | Extensions | Extracted |
|----------|-----------|-----------|
| TypeScript | `.ts` `.tsx` `.mts` `.cts` | Functions, classes, interfaces, type aliases, components, hooks, variables |
| JavaScript | `.js` `.jsx` `.mjs` `.cjs` | Functions, classes, components, variables |
| Python | `.py` `.pyi` | Functions, classes, decorators, variables |
| Go | `.go` | Functions, methods (with receiver), types (struct/interface), constants, variables |
| Java | `.java` | Classes, interfaces, enums, methods, fields |

## 5-Pass Pipeline

IGraph performs five traversal passes on each source file to incrementally build a complete symbol graph:

1. **Pass 1 — Exported Symbol Extraction**: Uses tree-sitter AST to extract exported functions, classes, components, etc., while collecting `extends` / `implements` placeholders
2. **Pass 2 — Internal Symbol Extraction**: Extracts non-exported module-level symbols (internal functions, classes, variables)
3. **Pass 3 — Import Resolution**: Resolves `import` / `require` statements, building `imports` dependency edges between files
4. **Pass 4 — Call Analysis**: Analyzes call expressions within function bodies, building `calls` relationship edges (priority: same file > imported > same directory > global weak match)
5. **Pass 5 — Reference Resolution**: Processes type references and JSX component usage, building `refs` relationship edges

## Extracted Node Types

| Type | Description | Example |
|------|-------------|---------|
| `function` | Regular or arrow function | `function verify()` / `const fn = () => {}` |
| `method` | Class method or Go method (with receiver) | `func (s *Server) Start()` / `public void handle()` |
| `class` | Class definition | `class UserService` |
| `component` | React / Vue component | `function App()` (returns JSX) |
| `hook` | React Hook | `function useAuth()` |
| `variable` | Module-level variable / constant | `const CONFIG = {}` |
| `type` | Type alias / interface | `interface User` / `type ID = string` |
| `module` | File module node (auto-generated per file) | Source node for `imports` edges |

## Extracted Relationship Types

| Relationship | Description |
|-------------|-------------|
| `calls` | Function A calls function B |
| `imports` | File A imports file B |
| `extends` | Class A extends class B |
| `implements` | Class A implements interface B |
| `exports` | File exports a symbol |
| `refs` | Type reference or JSX component usage |

## Parser Configuration

In the `parser` section of `.igraph/config.json`:

```json
{
  "parser": {
    "languages": ["typescript", "javascript", "python", "go", "java"],
    "include": ["src/**/*", "lib/**/*"],
    "exclude": ["node_modules/**", "dist/**", "**/*.test.*"]
  }
}
```

- `languages`: List of enabled languages
- `include`: File include glob patterns (default `["**/*"]`)
- `exclude`: File exclude glob patterns
