/**
 * graph/traverse.ts — 图遍历（递归 CTE 实现 N 跳遍历）
 *
 * 支持：
 * - 方向：
 *   - "callees"：沿出边前进（source → target），即「我调用/引用了谁」。
 *   - "callers"：沿入边回溯（target → source），即「谁调用/引用了我」。
 *   - "both"：双向。
 * - 边类型过滤：仅沿指定 kind 的边扩展（如 ['calls']）。
 * - 最大跳数 maxHops：限制递归深度，避免大图爆炸。
 *
 * 实现要点：使用 SQLite 递归 CTE，携带 depth 与 visited 路径去重，
 * 防止环导致的无限递归。返回可达节点及其最短跳数。
 */
import type { DB } from "./db.js";
import type { EdgeKind } from "../types/index.js";
import type { NodeRow } from "./nodes.js";

/** 遍历方向 */
export type TraverseDirection = "callers" | "callees" | "both";

/** 遍历选项 */
export interface TraverseOptions {
  /** 起始节点 id */
  startId: number;
  /** 方向，默认 "callees" */
  direction?: TraverseDirection;
  /** 最大跳数，默认 2 */
  maxHops?: number;
  /** 边类型过滤（为空则不过滤，遍历所有类型） */
  edgeKinds?: readonly EdgeKind[];
  /** 是否在结果中包含起始节点自身，默认 false */
  includeStart?: boolean;
}

/** 遍历命中的节点及其到起点的最短跳数 */
export interface TraverseHit {
  /** 命中的节点行 */
  node: NodeRow;
  /** 到起始节点的最短跳数（起点为 0） */
  depth: number;
}

/** 构造边类型过滤子句与参数 */
function buildKindFilter(
  edgeKinds: readonly EdgeKind[] | undefined,
): { clause: string; params: string[] } {
  if (!edgeKinds || edgeKinds.length === 0) {
    return { clause: "", params: [] };
  }
  const placeholders = edgeKinds.map(() => "?").join(", ");
  return { clause: `AND e.kind IN (${placeholders})`, params: [...edgeKinds] };
}

/**
 * 依据方向构造递归 CTE 中「下一跳」的连接条件。
 * - callees：next = e.target WHERE e.source = current
 * - callers：next = e.source WHERE e.target = current
 * - both：两条 UNION（在调用处组合）
 */
function stepSql(
  direction: "callers" | "callees",
  kindClause: string,
): string {
  const [fromCol, toCol] =
    direction === "callees" ? ["source", "target"] : ["target", "source"];
  return (
    `SELECT e.${toCol} AS id, t.depth + 1 AS depth ` +
    `FROM edges e JOIN traverse t ON e.${fromCol} = t.id ` +
    `WHERE t.depth < @maxHops ${kindClause}`
  );
}

/**
 * 从 startId 出发 N 跳遍历，返回可达节点（含最短跳数）。
 *
 * 使用递归 CTE，`traverse(id, depth)` 逐层扩展；外层用 MIN(depth) 聚合得到
 * 每个节点的最短跳数，天然对环安全（depth < maxHops 终止 + 分组去重）。
 */
export function traverse(db: DB, options: TraverseOptions): TraverseHit[] {
  const {
    startId,
    direction = "callees",
    maxHops = 2,
    edgeKinds,
    includeStart = false,
  } = options;

  const { clause: kindClause, params: kindParams } = buildKindFilter(edgeKinds);

  // 构造递归步（both 时用 UNION 合并两个方向）
  let recursiveBody: string;
  let stepParams: string[];
  if (direction === "both") {
    recursiveBody =
      stepSql("callees", kindClause) +
      " UNION " +
      stepSql("callers", kindClause);
    // both 时 kind 过滤参数出现两次
    stepParams = [...kindParams, ...kindParams];
  } else {
    recursiveBody = stepSql(direction, kindClause);
    stepParams = [...kindParams];
  }

  const sql =
    "WITH RECURSIVE traverse(id, depth) AS (" +
    "  SELECT @startId AS id, 0 AS depth" +
    "  UNION" +
    `  ${recursiveBody}` +
    ") " +
    "SELECT id, MIN(depth) AS depth FROM traverse " +
    (includeStart ? "" : "WHERE id != @startId ") +
    "GROUP BY id ORDER BY depth, id";

  // better-sqlite3 不支持命名与位置参数混用，这里统一改为对象绑定：
  // 将 kind 过滤的位置占位符替换为命名参数。
  const named = withNamedKindParams(sql, recursiveBody, stepParams);

  const rows = db.prepare(named.sql).all({
    startId,
    maxHops,
    ...named.bindings,
  }) as Array<{ id: number; depth: number }>;

  const hits: TraverseHit[] = [];
  for (const r of rows) {
    const node = db.prepare("SELECT * FROM nodes WHERE id = ?").get(r.id) as
      | NodeRow
      | undefined;
    if (node) hits.push({ node, depth: r.depth });
  }
  return hits;
}

/**
 * 将 SQL 中的 `?` 占位符（仅来自 kind 过滤）替换为命名参数 @k0, @k1, ...，
 * 以便与 @startId / @maxHops 一起用对象方式绑定（避免混用报错）。
 */
function withNamedKindParams(
  sql: string,
  _recursiveBody: string,
  kindParams: readonly string[],
): { sql: string; bindings: Record<string, string> } {
  const bindings: Record<string, string> = {};
  let index = 0;
  const replaced = sql.replace(/\?/g, () => {
    const key = `k${index}`;
    bindings[key] = kindParams[index] as string;
    index += 1;
    return `@${key}`;
  });
  return { sql: replaced, bindings };
}