# 贡献指南

感谢你对 IGraph 项目的关注！以下是参与贡献的说明。

## 环境要求

- **Node.js >= 18**
- C/C++ 编译工具链（用于编译 `better-sqlite3` 和 tree-sitter 原生插件）：
  - macOS: `xcode-select --install`
  - Linux: `build-essential` + `python3`
  - Windows: Visual Studio Build Tools

## 开发设置

```bash
# 1. Fork 并克隆仓库
git clone https://github.com/<your-username>/IGraph.git
cd IGraph

# 2. 安装依赖
npm install

# 3. 启动开发模式（watch 编译）
npm run dev

# 4. 运行测试
npm test

# 5. 类型检查
npm run typecheck

# 6. 代码格式化 + Lint
npm run format
npm run lint
```

## 项目结构

```
src/
├── cli/           # Commander.js 命令注册
├── config/        # 配置加载、合并、验证
├── parser/        # tree-sitter AST 解析（5-Pass 流水线）
├── graph/         # SQLite 图存储（CRUD + Schema + Traverse）
├── semantic/      # LLM 摘要 + 启发式降级
├── vector/        # 向量嵌入 + sqlite-vec
├── retrieval/     # 双通道 RRF 检索 + 图展开
├── multimodal/    # PRD/DB Schema 多模态挂载
├── mcp/           # MCP Server（stdio 传输）
├── incremental/   # 增量更新（SHA diff + 级联失效）
├── eval/          # 检索质量评测
└── utils/         # HTTP 客户端、日志
tests/             # Vitest 测试套件
website/           # VitePress 文档站
```

## 代码风格

- **格式化**: Prettier（项目根 `.prettierrc`）
- **Lint**: ESLint flat config（`eslint.config.mjs`）
- **TypeScript**: 严格模式全开，禁止 `any`
- **注释语言**: 代码标识符用英文，领域概念说明可用中文
- **注释原则**: 解释"为什么"而非"做了什么"，无冗余注释

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>(<scope>): <description>

[可选正文]

[可选脚注]
```

常用 type：

| Type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `refactor` | 重构（不改变行为） |
| `test` | 测试相关 |
| `chore` | 构建/工具/依赖变更 |
| `perf` | 性能优化 |

示例：

```
feat(parser): add Go language adapter

fix(retrieval): handle empty FTS results gracefully

docs(readme): update MCP integration section
```

## Pull Request 流程

1. 从 `main` 创建功能分支：`git checkout -b feat/your-feature`
2. 开发并提交（遵循提交规范）
3. 确保所有检查通过：
   ```bash
   npm run typecheck
   npm test
   npm run lint
   ```
4. Push 并创建 PR
5. 在 PR 描述中说明改动动机和测试方式
6. 等待 Code Review

## 测试要求

- 新功能需附带对应测试
- Bug 修复需附带复现用例
- 测试文件放在 `tests/` 目录，命名为 `<module>.test.ts`
- 使用 `openMemoryDatabase()` 进行数据库相关测试（内存隔离）
- 使用 `vi.fn()` / `vi.mock()` 进行外部依赖 mock

## 报告问题

- **Bug**: 请在 [Issues](https://github.com/Ychangqing/IGraph/issues) 中提交，包含复现步骤、环境信息和错误日志
- **Feature Request**: 同样在 Issues 中提交，描述使用场景和期望行为

## 行为准则

请保持友善、专业的交流态度。我们欢迎所有善意的贡献。
