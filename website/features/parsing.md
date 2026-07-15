# 多语言解析

IGraph 使用 [tree-sitter](https://tree-sitter.github.io/) 驱动的 5-Pass 流水线，将源代码解析为结构化的符号节点与关系边。

## 支持的语言

| 语言 | 扩展名 | 提取内容 |
|------|--------|---------|
| TypeScript | `.ts` `.tsx` `.mts` `.cts` | 函数、类、接口、类型别名、组件、Hook、变量 |
| JavaScript | `.js` `.jsx` `.mjs` `.cjs` | 函数、类、组件、变量 |
| Python | `.py` `.pyi` | 函数、类、装饰器、变量 |
| Go | `.go` | 函数、方法（含 receiver）、类型（struct/interface）、常量、变量 |
| Java | `.java` | 类、接口、枚举、方法、字段 |

## 5-Pass 解析流水线

IGraph 对每个源文件执行五轮遍历，逐步构建完整的符号图谱：

1. **Pass 1 — 导出符号提取**：使用 tree-sitter AST 提取 `export` 的函数、类、组件等符号节点，同时收集 `extends` / `implements` 占位
2. **Pass 2 — 内部符号提取**：提取非导出的模块级符号（内部函数、类、变量等）
3. **Pass 3 — 导入解析**：解析 `import` / `require` 语句，建立文件间 `imports` 依赖边
4. **Pass 4 — 调用分析**：分析函数体内的调用表达式，建立 `calls` 关系边（优先级：本文件 > 导入 > 同目录 > 全局弱匹配）
5. **Pass 5 — 引用解析**：处理类型引用、JSX 组件使用，建立 `refs` 关系边

## 提取的节点类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `function` | 普通函数或箭头函数 | `function verify()` / `const fn = () => {}` |
| `method` | 类方法或 Go 方法（带 receiver） | `func (s *Server) Start()` / `public void handle()` |
| `class` | 类定义 | `class UserService` |
| `component` | React / Vue 组件 | `function App()` (返回 JSX) |
| `hook` | React Hook | `function useAuth()` |
| `variable` | 模块级变量 / 常量 | `const CONFIG = {}` |
| `type` | 类型别名 / 接口 | `interface User` / `type ID = string` |
| `module` | 文件模块节点（每个文件自动生成） | 作为 `imports` 边的源节点 |

## 提取的关系类型

| 关系 | 说明 |
|------|------|
| `calls` | A 函数调用 B 函数 |
| `imports` | 文件 A 导入文件 B |
| `extends` | 类 A 继承类 B |
| `implements` | 类 A 实现接口 B |
| `exports` | 文件导出符号 |
| `refs` | 类型引用或 JSX 组件使用 |

## 配置解析器

在 `.igraph/config.json` 的 `parser` 部分：

```json
{
  "parser": {
    "languages": ["typescript", "javascript", "python", "go", "java"],
    "include": ["src/**/*", "lib/**/*"],
    "exclude": ["node_modules/**", "dist/**", "**/*.test.*"]
  }
}
```

- `languages`：启用的语言列表
- `include`：文件包含 glob 模式（默认 `["**/*"]`）
- `exclude`：文件排除 glob 模式
