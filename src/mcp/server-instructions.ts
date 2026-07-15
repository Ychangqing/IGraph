/**
 * mcp/server-instructions.ts — MCP Server instructions 生成
 *
 * MCP 协议的 `instructions` 字段会被 AI 客户端（如 Claude Code）自动注入到
 * 系统提示中，引导 AI 在合适的场景主动调用 igraph 工具。
 *
 * 根据图谱状态动态生成两种 instructions：
 * - 图谱已构建：完整使用指南 + 图谱统计信息
 * - 图谱为空/未构建：简短提示，建议运行 igraph build
 */
import type { DB } from "../graph/db.js";
import { countFiles, countNodes, countEdges } from "../graph/index.js";
import { countResources } from "../graph/resources.js";

/** 图谱统计信息 */
export interface GraphStats {
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  prdCount: number;
  dbCount: number;
}

/** 从数据库收集图谱统计信息 */
export function collectGraphStats(db: DB): GraphStats {
  return {
    fileCount: countFiles(db),
    nodeCount: countNodes(db),
    edgeCount: countEdges(db),
    prdCount: countResources(db, "prd"),
    dbCount: countResources(db, "db"),
  };
}

/** 生成图谱已构建时的 instructions */
export function buildServerInstructions(stats: GraphStats): string {
  const lines: string[] = [];

  lines.push("# IGraph — 代码知识图谱");
  lines.push("");
  lines.push("本项目已建立 IGraph 代码知识图谱。");
  lines.push(
    `图谱统计：${stats.fileCount} 个文件，${stats.nodeCount} 个符号节点，${stats.edgeCount} 条关系边。`,
  );

  if (stats.prdCount > 0) {
    lines.push(
      `已挂载 ${stats.prdCount} 个 PRD 需求文档片段，igraph_explore 可直接召回需求内容。`,
    );
  }
  if (stats.dbCount > 0) {
    lines.push(`已挂载 ${stats.dbCount} 个 DB Schema 片段。`);
  }

  lines.push("");
  lines.push("## 使用指南");
  lines.push("");
  lines.push(
    "实现新功能、理解需求、探索代码时，优先使用 igraph 工具而非 grep/find：",
  );
  lines.push("");
  lines.push(
    "- **igraph_explore**：自然语言语义检索。返回最相关的代码符号 + 图谱上下文 + 关联的 PRD/DB 资源。一次调用替代多次 grep + read。",
  );
  lines.push(
    "- **igraph_node**：查看某个符号的源码、签名、调用者和被调用者。",
  );
  lines.push(
    "- **igraph_file**：查看某个文件的摘要、导出符号和节点列表。",
  );
  lines.push(
    "- **igraph_related**：展开某符号的调用链和关联资源。",
  );

  lines.push("");
  lines.push("## 何时使用 igraph_explore");
  lines.push("");
  lines.push(
    "- 实现新功能前：先用 igraph_explore 检索需求关键词，会自动召回相关的 PRD 需求文档和现有代码",
  );
  lines.push(
    "- 修改现有功能前：检索相关代码的调用链和依赖关系，避免遗漏关联改动",
  );
  lines.push(
    "- 探索代码结构：用自然语言描述你要找的内容，比 grep 关键词更精准",
  );

  lines.push("");
  lines.push("## 降级策略");
  lines.push("");
  lines.push(
    "- igraph 工具未返回结果或结果不够时，再使用 grep/find/read 等工具补充",
  );
  lines.push(
    "- 新建的文件（尚未 igraph build）不在图谱中，此时直接用内置工具",
  );

  lines.push("");
  lines.push("## 反模式");
  lines.push("");
  lines.push(
    "- 不要先 grep 再逐文件 read —— igraph_explore 一次调用就能语义定位",
  );
  lines.push(
    "- 不要只看单个文件 —— igraph_explore 会展开图谱邻居和关联资源",
  );

  return lines.join("\n");
}

/** 图谱未构建时的 instructions */
export const SERVER_INSTRUCTIONS_EMPTY =
  "# IGraph — 未构建\n\n" +
  "本项目尚未构建 IGraph 代码知识图谱，igraph 工具暂不可用。\n" +
  "请运行 `igraph build` 构建图谱后重新启动。";

/**
 * 根据数据库状态生成合适的 instructions。
 */
export function generateInstructions(db: DB): string {
  const stats = collectGraphStats(db);
  if (stats.fileCount === 0) return SERVER_INSTRUCTIONS_EMPTY;
  return buildServerInstructions(stats);
}
