/**
 * graph/ingest.ts — 将 M1 解析结果（ParseResult）落库到 SQLite。
 *
 * 核心职责：把内存中的临时标识（`filePath#name`）映射为数据库真实自增 id。
 *
 * 落库顺序（保证外键约束）：
 *   1. files：upsert 得到 file_path → file_id。
 *   2. nodes：按 file_id 批量插入，建立 `filePath#name` → node_id 映射。
 *      其中文件入口节点（kind=module，标识 `filePath#*`）也一并落库，
 *      使其获得真实 node_id。
 *   3. edges：用节点映射把 source/target 临时标识翻译为 node_id 后批量插入。
 *
 * imports 边：M1 中其 source 为文件入口节点 `filePath#*`（kind=module），
 * 该节点已随 nodes 落库并纳入映射，因此 source/target 均可正常解析。
 * 若极少数边的两端仍无法映射到真实节点（如目标文件未被扫描），则跳过该边
 * 并计入 edgesUnresolved 统计，避免外键失败。
 */
import type { DB } from "./db.js";
import type { ParseResult } from "../types/index.js";
import { createHash } from "node:crypto";
import { upsertFiles } from "./files.js";
import { insertNodes, resolveNodeByTempId, type NodeInput } from "./nodes.js";
import { insertEdges, type EdgeInput } from "./edges.js";

/** 落库结果统计 */
export interface IngestResult {
  /** 写入 / 更新的文件数 */
  files: number;
  /** 写入的节点数 */
  nodes: number;
  /** 实际新增的边数（去重后） */
  edges: number;
  /** 因去重被忽略的边数 */
  edgesSkipped: number;
  /** 因无法映射临时标识（如 imports 的 `filePath#*` 占位）而跳过的边数 */
  edgesUnresolved: number;
}

/** 计算源码内容哈希（sha256，用于增量判断与文件指纹） */
function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * 将 ParseResult 落库，返回统计信息。
 *
* @param db     已打开且完成迁移的数据库连接
 * @param result M1 parseRepository 的输出
 */
export function ingestParseResult(db: DB, result: ParseResult): IngestResult {
  // 整个落库过程包裹在单事务中，任一步失败整体回滚，避免半写状态。
  const tx = db.transaction((parse: ParseResult): IngestResult => {
    // ---- 1) files ----
    const fileInputs = parse.files.map((f) => ({
      filePath: f.filePath,
      language: f.language,
      hash: hashContent(f.sourceCode),
    }));
    const fileIdByPath = upsertFiles(db, fileInputs);

    // ---- 2) nodes ----
    // 按输入顺序构造 NodeInput；缺失 file_id 的节点（文件未被扫描）跳过。
    const nodeInputs: NodeInput[] = [];
    const tempIds: string[] = []; // 与 nodeInputs 一一对应的临时标识
    for (const node of parse.nodes) {
      const fileId = fileIdByPath.get(node.filePath);
      if (fileId === undefined) continue; // 理论上不应发生
      nodeInputs.push({
        fileId,
        name: node.name,
        kind: node.kind,
        signature: node.signature,
        startLine: node.startLine,
        endLine: node.endLine,
        isExported: node.isExported,
        sourceCode: node.sourceCode,
      });
      tempIds.push(node.id);
    }
    const nodeIds = insertNodes(db, nodeInputs);

    // 建立临时标识 → node_id 映射
    const nodeIdByTemp = new Map<string, number>();
    for (let i = 0; i < tempIds.length; i += 1) {
      const key = tempIds[i];
      const id = nodeIds[i];
      if (key !== undefined && id !== undefined) {
        nodeIdByTemp.set(key, id);
      }
    }

    // ---- 3) edges ----
    // 将临时标识翻译为 node_id；优先从本批次映射查，未命中则回退查库中已有节点
    // （支持增量模式下跨文件边解析——一端在本次子集、另一端在库中已有）。
    const edgeInputs: EdgeInput[] = [];
    let unresolved = 0;
    for (const edge of parse.edges) {
      const source = nodeIdByTemp.get(edge.source) ?? resolveNodeByTempId(db, edge.source);
      const target = nodeIdByTemp.get(edge.target) ?? resolveNodeByTempId(db, edge.target);
      if (source === undefined || target === undefined) {
        unresolved += 1;
        continue;
      }
      edgeInputs.push({ source, target, kind: edge.kind });
    }
    const edgeResult = insertEdges(db, edgeInputs);

    return {
      files: fileIdByPath.size,
      nodes: nodeIds.length,
      edges: edgeResult.inserted,
      edgesSkipped: edgeResult.skipped,
      edgesUnresolved: unresolved,
    };
  });

  return tx(result);
}