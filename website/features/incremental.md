# 增量构建

IGraph 基于 **SHA-256 diff** 实现增量构建，大幅减少重复构建时间。

## 工作原理

每次构建时，IGraph 记录每个文件的 SHA-256 哈希。再次运行 `build` 时，仅处理发生变更的文件：

```bash
# 首次构建（全量）
igraph build
# ✓ 解析 142 个文件，生成 856 个符号节点

# 修改了 3 个文件后再次构建（增量）
igraph build
# ✓ 检测到 3 个变更文件，增量更新 18 个节点
```

## 级联更新

增量构建不仅更新变更文件本身，还会级联更新受影响的关联内容：

1. **文件变更** → 重新解析该文件的符号
2. **符号变更** → 更新该符号的调用关系边
3. **关系变更** → 重新生成受影响符号的摘要
4. **摘要变更** → 重新向量化受影响的节点

这确保图谱始终与源代码保持一致。

## 强制全量重建

如果需要推倒重建（例如更换了 LLM 模型、修改了解析配置），使用 `rebuild`：

```bash
igraph rebuild            # 清空数据库，全量重建
igraph rebuild --no-llm   # 全量重建（启发式降级）
igraph rebuild --dry-run  # 仅预览，不执行
```

## 构建选项

| 命令 | 行为 |
|------|------|
| `igraph build` | 自动增量（首次为全量） |
| `igraph build --incremental` | 显式增量模式 |
| `igraph build --dry-run` | 预览解析统计，不写库 |
| `igraph build --no-llm` | 跳过 LLM 摘要和向量化 |
| `igraph rebuild` | 清空并全量重建 |
| `igraph rebuild --full` | 同 `rebuild`（默认行为） |
