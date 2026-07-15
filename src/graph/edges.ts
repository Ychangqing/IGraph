/**
 * graph/edges.ts — edges 表 CRUD（含批量插入 + 去重）
 *
 * edges 表记录节点间关系（calls / refs / imports / extends / implements），
 * source / target 均为 nodes.id。UNIQUE(source, target, kind) 保证同一关系
 * 不重复；批量插入使用 INSERT OR IGNORE 实现去重（重复项静默跳过）。
 */
import type { DB } from "./db.js";
import type { EdgeKind } from "../types/index.js";

/** edges 表完整行 */
export interface EdgeRow {
  id: number;
  source: number;
  target: number;
  kind: string;
  created_at: string;
}

/** 插入 edges 的入参 */
export interface EdgeInput {
  source: number;
  target: number;
  kind: EdgeKind;
}

/** 批量插入结果统计 */
export interface InsertEdgesResult {
  /** 实际新增的边数（去重后） */
  inserted: number;
  /** 因 UNIQUE 冲突被忽略的重复边数 */
  skipped: number;
}

const INSERT_SQL =
  "INSERT OR IGNORE INTO edges(source, target, kind) VALUES (@source, @target, @kind)";

/**
 * 插入单条边（去重）。返回是否实际新增（false 表示已存在被忽略）。
 */
export function insertEdge(db: DB, input: EdgeInput): boolean {
  const info = db.prepare(INSERT_SQL).run(input);
  return info.changes > 0;
}

/**
 * 批量插入边，UNIQUE(source,target,kind) 去重。
 * 返回新增 / 跳过统计。全部包裹在单个事务内。
 */
export function insertEdges(
  db: DB,
  inputs: readonly EdgeInput[],
): InsertEdgesResult {
  const stmt = db.prepare(INSERT_SQL);
  let inserted = 0;
  const tx = db.transaction((rows: readonly EdgeInput[]) => {
    for (const row of rows) {
      const info = stmt.run(row);
      if (info.changes > 0) inserted += 1;
    }
  });
  tx(inputs);
  return { inserted, skipped: inputs.length - inserted };
}

/** 按 id 查询边 */
export function getEdgeById(db: DB, id: number): EdgeRow | undefined {
  return db.prepare("SELECT * FROM edges WHERE id = ?").get(id) as
    | EdgeRow
    | undefined;
}

/** 查询以某节点为源的出边（可按边类型过滤） */
export function getOutgoingEdges(
  db: DB,
  source: number,
  kind?: EdgeKind,
): EdgeRow[] {
  if (kind) {
    return db
      .prepare("SELECT * FROM edges WHERE source = ? AND kind = ?")
      .all(source, kind) as EdgeRow[];
  }
  return db.prepare("SELECT * FROM edges WHERE source = ?").all(source) as EdgeRow[];
}

/** 查询以某节点为目标的入边（可按边类型过滤） */
export function getIncomingEdges(
  db: DB,
  target: number,
  kind?: EdgeKind,
): EdgeRow[] {
  if (kind) {
    return db
      .prepare("SELECT * FROM edges WHERE target = ? AND kind = ?")
      .all(target, kind) as EdgeRow[];
  }
  return db.prepare("SELECT * FROM edges WHERE target = ?").all(target) as EdgeRow[];
}

/** 统计边总数 */
export function countEdges(db: DB): number {
  return db.prepare("SELECT count(*) FROM edges").pluck().get() as number;
}

/** 列出所有边（调试 / 测试用） */
export function listEdges(db: DB): EdgeRow[] {
  return db.prepare("SELECT * FROM edges ORDER BY id").all() as EdgeRow[];
}