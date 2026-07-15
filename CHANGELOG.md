# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本号遵循 [Semantic Versioning](https://semver.org/)。

## [0.1.0] - 2025-07-15

首次公开发布。

### Added

- **多语言代码解析**: 支持 TypeScript、JavaScript、Python、Go、Java，基于 tree-sitter 的 5-Pass 流水线（提取导出符号 → 内部符号 → 解析导入 → 检测调用 → 检测引用）
- **知识图谱存储**: SQLite + sqlite-vec，存储文件/符号节点 + 调用/导入/继承/引用关系边
- **LLM 语义摘要**: 对文件和符号生成自然语言摘要；`--no-llm` 走启发式降级
- **向量化索引**: BGE-M3 1024 维向量，支持批量嵌入和断点续传
- **双通道检索**: Dense（KNN）+ FTS5（BM25）经 RRF 融合，两级检索（文件粗筛 → 符号精排）
- **图谱展开**: N-hop 邻居扩展，为检索结果提供上下文子图
- **多模态挂载**: 支持 PRD 文档（.md/.txt/.pdf/.docx）和 DB Schema（.sql/.json/.xlsx）与代码建立语义关联
- **独立资源检索**: 无代码关联的 PRD/DB 资源也可通过向量搜索和 FTS 召回
- **增量构建**: 基于 SHA-256 diff 的级联更新，仅重建受影响文件
- **MCP Server**: stdio 传输，暴露 `igraph_explore`、`igraph_node`、`igraph_file`、`igraph_related` 四个只读检索 Tool
- **MCP Instructions**: 服务端自动注入使用指引，引导 AI 助手优先调用 igraph 工具
- **自动注册**: `igraph register` 一键注册到 Claude Code / Cursor
- **全局配置**: `~/.igraph/config.json` + `igraph config` 命令，API Key 一次设置所有项目共享
- **凭据安全**: 项目配置禁止含凭据字段（防 git 提交），全局配置和环境变量提供凭据
- **检索评测**: `igraph eval` 输出 Recall@K、MRR 等指标
- **离线可用**: 无 API Key 时自动降级为 FTS5 检索 + 启发式摘要
