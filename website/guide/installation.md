# 安装

## 环境要求

- **Node.js >= 18**
- IGraph 依赖 `better-sqlite3` 与 tree-sitter 系列**原生编译型插件**，安装时会在本机编译。请确保具备 C/C++ 构建工具链：

| 平台 | 需要安装 |
|------|---------|
| macOS | Xcode Command Line Tools（`xcode-select --install`） |
| Linux | `build-essential`、`python3` |
| Windows | `windows-build-tools` 或 Visual Studio Build Tools |

## 全局安装

推荐全局安装以获得 `igraph` 命令：

```bash
npm install -g igraph-cli
```

## 项目内安装

也可在项目中作为本地依赖安装：

```bash
npm install igraph-cli
```

安装完成后即可使用 `igraph` 命令，运行 `igraph --version` 验证。

## 全局选项

所有命令均支持以下全局选项：

| 选项 | 说明 |
|------|------|
| `-v, --verbose` | 输出调试日志 |
| `-q, --quiet` | 仅输出错误日志 |
| `-V, --version` | 输出版本号 |
