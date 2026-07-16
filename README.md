<p align="center">
  <img src="website/public/logo.svg" width="120" alt="IGraph Logo" />
</p>

<h1 align="center">IGraph</h1>

<p align="center">
  代码知识图谱构建工具 — 解析 → 语义化 → 向量化
</p>

<p align="center">
  简体中文 · <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/igraph-cli"><img src="https://img.shields.io/npm/v/igraph-cli?color=blue&label=npm" alt="npm version" /></a>
  <a href="https://github.com/Ychangqing/IGraph/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Ychangqing/IGraph" alt="license" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node version" /></a>
  <a href="https://github.com/Ychangqing/IGraph/actions"><img src="https://img.shields.io/github/actions/workflow/status/Ychangqing/IGraph/deploy-docs.yml?label=docs" alt="docs build" /></a>
  <a href="https://github.com/Ychangqing/IGraph/issues"><img src="https://img.shields.io/github/issues/Ychangqing/IGraph" alt="issues" /></a>
</p>

<p align="center">
  <a href="https://ychangqing.github.io/IGraph/">官网文档</a> ·
  <a href="https://ychangqing.github.io/IGraph/guide/quick-start">快速开始</a> ·
  <a href="https://ychangqing.github.io/IGraph/reference/cli">CLI 参考</a> ·
  <a href="https://ychangqing.github.io/IGraph/features/mcp">MCP 集成</a>
</p>

---

## 🎯 简介

IGraph 把代码仓库解析为「符号节点 + 调用关系边」的知识图谱，叠加 LLM 语义摘要与向量索引，通过双通道（Dense + FTS5）RRF 融合检索对外服务。支持挂载 PRD / DB Schema 等多模态资源建立跨模态关联，内置 MCP Server 可直接接入 Cursor / Claude Code 等 AI 助手。

## ✨ 核心能力

| 能力 | 说明 |
|------|------|
| 🌳 多语言解析 | tree-sitter 驱动 5-Pass 流水线，支持 TypeScript / JavaScript / Python / Go / Java |
| 🧠 语义摘要 | LLM 为文件与符号生成摘要，`--no-llm` 时走启发式降级 |
| 🔍 双通道检索 | BGE-M3 向量 + FTS5 全文检索，经 RRF 融合 |
| 📎 多模态挂载 | PRD 文档、DB Schema 按语义相似度建立跨模态关联 |
| ⚡ 增量构建 | 基于 SHA-256 diff 的级联更新，仅重建受影响文件 |
| 🤖 MCP 集成 | 一条命令接入 Cursor / Claude Code |

## 📦 安装

**环境要求：** Node.js >= 18，C/C++ 构建工具链（原生编译依赖）

```bash
# 全局安装
npm install -g igraph-cli

# 或项目本地安装
npm install igraph-cli
```

<details>
<summary>构建工具链安装</summary>

- **macOS：** `xcode-select --install`
- **Linux：** `sudo apt install build-essential python3`
- **Windows：** Visual Studio Build Tools

</details>

## 🚀 快速开始

```bash
# 1. 初始化
igraph init

# 2. 注入凭据（全局配置，一次设置所有项目共享）
igraph config set apiKey sk-...

# 3. 构建图谱
igraph build

# 4. 注册 MCP Server 到 AI 助手
igraph register

# 5. 自然语言查询
igraph query "用户鉴权在哪里实现"
```

> 无 API Key 时可用 `igraph build --no-llm` 走启发式降级，`query` / `serve` 自动降级为仅 FTS5 检索。

更多用法请查看 [官网文档](https://ychangqing.github.io/IGraph/guide/quick-start)。

## 🤖 MCP 集成

```bash
# 自动检测已安装的 AI 助手并注册
igraph register

# 指定目标
igraph register --target claude
igraph register --target cursor

# 注销
igraph unregister
```

注册后 AI 助手可直接调用 4 个只读检索 Tool：

| Tool | 说明 |
|------|------|
| `igraph_explore` | 自然语言检索，附带图谱上下文展开 |
| `igraph_node` | 按符号名获取节点详情 |
| `igraph_file` | 按文件路径获取文件图谱信息 |
| `igraph_related` | 展开某符号的关联资源 |

详见 [MCP Tool 文档](https://ychangqing.github.io/IGraph/reference/mcp-tools)。

## 📋 命令速查

| 命令 | 说明 |
|------|------|
| `igraph init` | 初始化配置 |
| `igraph build` | 构建图谱（自动增量） |
| `igraph rebuild` | 清空并全量重建 |
| `igraph status` | 查看图谱状态 |
| `igraph query` | 自然语言检索 |
| `igraph eval` | 评测检索质量 |
| `igraph serve` | 启动 MCP Server |
| `igraph register` | 注册到 AI 助手 |
| `igraph mount prd` | 挂载 PRD 文档 |
| `igraph mount db` | 挂载 DB Schema |
| `igraph config` | 管理全局配置 |

## 🗂 支持的语言与格式

| 类别 | 语言 / 类型 | 扩展名 |
|------|------------|--------|
| 代码 | TypeScript | `.ts` `.tsx` `.mts` `.cts` |
| 代码 | JavaScript | `.js` `.jsx` `.mjs` `.cjs` |
| 代码 | Python | `.py` `.pyi` |
| 代码 | Go | `.go` |
| 代码 | Java | `.java` |
| 多模态 | PRD 文档 | `.md` `.txt` `.pdf` `.docx` |
| 多模态 | DB Schema | `.sql` `.ddl` `.json` `.xlsx` |

## 🛠 开发

```bash
npm run dev        # watch 模式
npm test           # vitest
npm run lint       # eslint
npm run typecheck  # 类型检查
npm run build      # 构建
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详情。

## 📄 License

[MIT](LICENSE) © 2024-present IGraph
