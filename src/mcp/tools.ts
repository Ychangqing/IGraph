/**
 * mcp/tools.ts — igraph MCP tools 定义与 handler（P2 / M6）
 *
 * 暴露 4 个只读检索类 tool，供支持 MCP 的客户端（IDE / Agent）通过 stdio 调用：
 * - igraph_explore：自然语言检索代码符号 / 调用链 / PRD / DB（双通道 + 图谱展开）。
 * - igraph_node   ：获取符号详情（源码 / 调用者 / 被调用者）。
 * - igraph_file   ：获取文件图谱信息（摘要 / 导出符号 / 节点列表）。
 * - igraph_related：关联资源展开（callers / callees / both）。
 *
 * 设计要点（与 P1 一致）：
 * - 输入参数一律**手写校验**（不引 zod）；inputSchema 手写 JSON Schema。
 * - 检索能力**直接复用** src/retrieval 与 src/graph，不重复造轮子。
 * - 降级：无 IGRAPH_API_KEY / 无向量时 explore 走 searchFtsOnly（对齐 query 命令），不崩溃。
 * - 依赖注入：查询执行封装为纯函数，db / EmbeddingClient 工厂可注入 mock 以便单测。
 * - 结果格式化为 AI 友好的结构化对象 + 文本摘要，作为 MCP text content 返回。
 */
import type { DB } from "../graph/db.js";
import { getNodeById, getNodesByName, getNodesByFile, type NodeRow } from "../graph/nodes.js";
import { getFileById, getFileByPath, type FileRow } from "../graph/files.js";
import { getOutgoingEdges, getIncomingEdges } from "../graph/edges.js";
import { countVectors } from "../vector/store.js";
import { EmbeddingClient } from "../vector/index.js";
import type { ResolvedConfig } from "../config/index.js";
import {
  search,
  searchFtsOnly,
  expandGraph,
  formatResult,
  collectResources,
  type FormattedResult,
  type FormattedResource,
  type SearchResponse,
} from "../retrieval/index.js";

// ── JSON Schema（手写，符合 MCP tool inputSchema 约定）──────────────

/** MCP tool 定义（name + description + 手写 JSON Schema） */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
}

/** 4 个 tool 的静态定义（供 ListTools 响应） */
export const TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
  {
    name: "igraph_explore",
    description:
      "自然语言检索代码知识图谱：返回最相关的符号（函数/类/组件/Hook/类型），并附带图谱展开的上下文（调用者/被调用者）。适合“这段逻辑在哪实现”“谁负责鉴权”等探索型问题。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "自然语言查询", maxLength: 2000 },
        topK: { type: "integer", description: "返回结果数（默认 5）", minimum: 1, maximum: 50 },
        hops: { type: "integer", description: "图谱展开跳数（默认 2）", minimum: 0, maximum: 5 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "igraph_node",
    description:
      "按符号名获取节点详情：源码、签名、位置、摘要，以及调用者（callers）与被调用者（callees）。同名多个时可用 file 过滤。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "符号名（函数/类/组件等）" },
        file: { type: "string", description: "可选文件路径过滤（用于同名消歧）" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "igraph_file",
    description:
      "按文件路径获取文件图谱信息：文件摘要、语言、导出符号、以及该文件内的全部节点列表。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径（相对仓库根）" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "igraph_related",
    description:
      "展开某符号的关联资源：direction=callers（谁调用它）/ callees（它调用谁）/ both（默认，双向）。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "符号名" },
        direction: {
          type: "string",
          enum: ["callers", "callees", "both"],
          description: "展开方向（默认 both）",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
];

// ── 手写校验 ────────────────────────────────────────────────────────

/** 校验失败异常（handler 捕获后转为 MCP 错误响应） */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/** 断言入参为非空对象 */
function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ToolInputError("参数必须为对象");
  }
  return input as Record<string, unknown>;
}

/** 读取必填字符串（去除首尾空白后不得为空） */
function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new ToolInputError(`参数 ${key} 必须为非空字符串`);
  }
  return v.trim();
}

/** 读取可选字符串（缺省或空返回 undefined） */
function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new ToolInputError(`参数 ${key} 必须为字符串`);
  }
  const t = v.trim();
  return t === "" ? undefined : t;
}

/** 读取可选正整数（含范围校验），缺省返回 fallback */
function optionalInt(
  obj: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const v = obj[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new ToolInputError(`参数 ${key} 必须为整数`);
  }
  if (v < min || v > max) {
    throw new ToolInputError(`参数 ${key} 必须在 [${min}, ${max}] 范围内`);
  }
  return v;
}

// ── 校验后的入参类型 ────────────────────────────────────────────────

export interface ExploreArgs {
  query: string;
  topK: number;
  hops: number;
}
export interface NodeArgs {
  name: string;
  file?: string;
}
export interface FileArgs {
  path: string;
}
export type RelatedDirection = "callers" | "callees" | "both";
export interface RelatedArgs {
  name: string;
  direction: RelatedDirection;
}

/** 校验 igraph_explore 入参 */
export function validateExploreArgs(input: unknown): ExploreArgs {
  const obj = asRecord(input);
  const query = requireString(obj, "query");
  // 过长查询可能拖垮 FTS5 / Embedding，限制上限为 2000 字符。
  if (query.length > 2000) {
    throw new ToolInputError("参数 query 长度不得超过 2000 字符");
  }
  return {
    query,
    topK: optionalInt(obj, "topK", 5, 1, 50),
    hops: optionalInt(obj, "hops", 2, 0, 5),
  };
}

/** 校验 igraph_node 入参 */
export function validateNodeArgs(input: unknown): NodeArgs {
  const obj = asRecord(input);
  const args: NodeArgs = { name: requireString(obj, "name") };
  const file = optionalString(obj, "file");
  if (file !== undefined) args.file = file;
  return args;
}

/** 校验 igraph_file 入参 */
export function validateFileArgs(input: unknown): FileArgs {
  const obj = asRecord(input);
  return { path: requireString(obj, "path") };
}

/** 校验 igraph_related 入参 */
export function validateRelatedArgs(input: unknown): RelatedArgs {
  const obj = asRecord(input);
  const name = requireString(obj, "name");
  const raw = optionalString(obj, "direction") ?? "both";
  if (raw !== "callers" && raw !== "callees" && raw !== "both") {
    throw new ToolInputError('参数 direction 必须为 "callers" | "callees" | "both"');
  }
  return { name, direction: raw };
}

// ── 执行上下文（依赖注入，便于单测 mock）──────────────────────────────

/**
 * tool handler 运行上下文。
 * - db：已打开的图谱数据库（只读使用）。
 * - config：已解析配置（含 credentials，可能无 API Key）。
 * - makeEmbeddingClient：Embedding 客户端工厂，缺省用真实 EmbeddingClient；
 *   单测可注入 mock 以避免网络调用。
 */
export interface ToolContext {
  db: DB;
  config: ResolvedConfig;
  makeEmbeddingClient?: (config: ResolvedConfig) => EmbeddingClient;
}

/** 默认 EmbeddingClient 工厂（从 config 组装，凭据来自 env 注入的 credentials） */
function defaultEmbeddingClient(config: ResolvedConfig): EmbeddingClient {
  return new EmbeddingClient({
    baseURL: config.credentials.embeddingBaseURL ?? config.embedding.baseURL,
    model: config.embedding.model,
    apiKey: config.credentials.apiKey,
    dimensions: config.embedding.dimensions,
    batchSize: config.embedding.batchSize,
  });
}

// ── 结果类型（AI 友好结构化）────────────────────────────────────────

/** 符号简要视图 */
export interface NodeBrief {
  nodeId: number;
  name: string;
  kind: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
}

/** igraph_explore 结果 */
export interface ExploreResult {
  tool: "igraph_explore";
  query: string;
  degraded: boolean;
  note?: string;
  result: FormattedResult;
}

/** igraph_node 结果 */
export interface NodeDetailResult {
  tool: "igraph_node";
  name: string;
  found: boolean;
  ambiguous: boolean;
  detail: {
    nodeId: number;
    name: string;
    kind: string;
    filePath: string | null;
    signature: string | null;
    startLine: number | null;
    endLine: number | null;
    summary: string | null;
    sourceCode: string | null;
    callers: NodeBrief[];
    callees: NodeBrief[];
  } | null;
  candidates: NodeBrief[];
}

/** igraph_file 结果 */
export interface FileInfoResult {
  tool: "igraph_file";
  path: string;
  found: boolean;
  info: {
    fileId: number;
    filePath: string;
    language: string | null;
    summary: string | null;
    exportedSymbols: NodeBrief[];
    nodes: NodeBrief[];
  } | null;
}

/** igraph_related 结果 */
export interface RelatedResult {
  tool: "igraph_related";
  name: string;
  direction: RelatedDirection;
  found: boolean;
  seeds: NodeBrief[];
  neighbors: (NodeBrief & { depth: number })[];
  resources: FormattedResource[];
}

// ── 内部辅助 ────────────────────────────────────────────────────────

/** 将 NodeRow 投影为 NodeBrief（附带文件路径解析） */
function toBrief(db: DB, node: NodeRow): NodeBrief {
  const f = getFileById(db, node.file_id);
  return {
    nodeId: node.id,
    name: node.name,
    kind: node.kind,
    filePath: f?.file_path ?? null,
    startLine: node.start_line,
    endLine: node.end_line,
  };
}

/** 解析节点关联的边端点为 NodeBrief 列表（去重，跳过失效端点） */
function briefsFromEdgeIds(db: DB, ids: readonly number[]): NodeBrief[] {
  const seen = new Set<number>();
  const out: NodeBrief[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const node = getNodeById(db, id);
    if (node) out.push(toBrief(db, node));
  }
  return out;
}

/** 按 name（可选 file 过滤）解析目标节点集合 */
function resolveNodesByName(db: DB, name: string, file?: string): NodeRow[] {
  const all = getNodesByName(db, name);
  if (file === undefined) return all;
  return all.filter((n) => {
    const f = getFileById(db, n.file_id);
    return f?.file_path === file || (f?.file_path?.endsWith(file) ?? false);
  });
}

// ── handler 实现（纯异步函数，返回结构化结果）────────────────────────

/** igraph_explore：双通道检索 + 图谱展开 + 格式化（含无密钥降级） */
export async function handleExplore(ctx: ToolContext, args: ExploreArgs): Promise<ExploreResult> {
  const { db, config } = ctx;
  const hasVectors = countVectors(db, "node_vectors") > 0;
  const hasApiKey = config.credentials.apiKey.trim() !== "";
  const canDense = hasVectors && hasApiKey;

  let response: SearchResponse;
  let note: string | undefined;

  if (canDense) {
    const client = (ctx.makeEmbeddingClient ?? defaultEmbeddingClient)(config);
    response = await search(db, client, args.query, {
      retrieval: config.retrieval,
      limit: args.topK,
    });
  } else {
    const reason = !hasVectors
      ? "数据库无 node 向量（可能以 --no-llm 构建）"
      : "未配置 IGRAPH_API_KEY，无法向量化 query";
    note = `无 Embedding 服务，已降级为仅 FTS5 通道检索（RRF 融合，dense 通道为空）；原因：${reason}`;
    response = searchFtsOnly(db, args.query, {
      retrieval: config.retrieval,
      limit: args.topK,
    });
  }

  const seedIds = response.results.map((r) => r.nodeId);
  const neighbors = expandGraph(db, seedIds, {
    maxHops: args.hops,
    direction: "both",
  });
  const result = formatResult(db, args.query, response, neighbors, {
    queryVec: response.queryVec ?? undefined,
    query: args.query,
    topK: config.retrieval.resourceTopK,
  });

  const out: ExploreResult = {
    tool: "igraph_explore",
    query: args.query,
    degraded: !canDense,
    result,
  };
  if (note !== undefined) out.note = note;
  return out;
}

/** igraph_node：符号详情 + callers/callees */
export function handleNode(ctx: ToolContext, args: NodeArgs): NodeDetailResult {
  const { db } = ctx;
  const matches = resolveNodesByName(db, args.name, args.file);
  const candidates = matches.map((n) => toBrief(db, n));

  if (matches.length === 0) {
    return {
      tool: "igraph_node",
      name: args.name,
      found: false,
      ambiguous: false,
      detail: null,
      candidates: [],
    };
  }

  // 多个同名时取第一个作为 detail，其余列入 candidates 供消歧。
  const target = matches[0] as NodeRow;
  const callerIds = getIncomingEdges(db, target.id, "calls").map((e) => e.source);
  const calleeIds = getOutgoingEdges(db, target.id, "calls").map((e) => e.target);

  return {
    tool: "igraph_node",
    name: args.name,
    found: true,
    ambiguous: matches.length > 1,
    detail: {
      nodeId: target.id,
      name: target.name,
      kind: target.kind,
      filePath: getFileById(db, target.file_id)?.file_path ?? null,
      signature: target.signature,
      startLine: target.start_line,
      endLine: target.end_line,
      summary: target.summary,
      sourceCode: target.source_code,
      callers: briefsFromEdgeIds(db, callerIds),
      callees: briefsFromEdgeIds(db, calleeIds),
    },
    candidates,
  };
}

/** igraph_file：文件图谱信息 */
export function handleFile(ctx: ToolContext, args: FileArgs): FileInfoResult {
  const { db } = ctx;
  let file: FileRow | undefined = getFileByPath(db, args.path);
  // 兼容后缀匹配（客户端可能传相对/绝对片段）。
  if (file === undefined) {
    // 无精确匹配时不做全表扫描，直接返回未命中。
    return { tool: "igraph_file", path: args.path, found: false, info: null };
  }

  // 只查一次原始 NodeRow[]，基于同一结果分别派生 nodes 与 exported，避免重复查询。
  const rawNodes = getNodesByFile(db, file.id);
  const nodes = rawNodes.map((n) => toBrief(db, n));
  const exported = rawNodes
    .filter((n) => n.is_exported === 1)
    .map((n) => toBrief(db, n));

  return {
    tool: "igraph_file",
    path: args.path,
    found: true,
    info: {
      fileId: file.id,
      filePath: file.file_path,
      language: file.language,
      summary: file.file_summary,
      exportedSymbols: exported,
      nodes,
    },
  };
}

/** igraph_related：关联资源展开（callers/callees/both） */
export function handleRelated(ctx: ToolContext, args: RelatedArgs): RelatedResult {
  const { db } = ctx;
  const matches = getNodesByName(db, args.name);
  if (matches.length === 0) {
    return {
      tool: "igraph_related",
      name: args.name,
      direction: args.direction,
      found: false,
      seeds: [],
      neighbors: [],
      resources: [],
    };
  }

  const seedIds = matches.map((n) => n.id);
  const expanded = expandGraph(db, seedIds, {
    maxHops: 2,
    direction: args.direction,
  });

  const filePathCache = new Map<number, string | null>();
  const filePathOf = (fileId: number): string | null => {
    if (filePathCache.has(fileId)) return filePathCache.get(fileId) ?? null;
    const f = getFileById(db, fileId);
    const p = f?.file_path ?? null;
    filePathCache.set(fileId, p);
    return p;
  };

  const fileIds = new Set<number>();
  for (const m of matches) fileIds.add(m.file_id);
  for (const e of expanded) fileIds.add(e.node.file_id);

  return {
    tool: "igraph_related",
    name: args.name,
    direction: args.direction,
    found: true,
    seeds: matches.map((n) => toBrief(db, n)),
    neighbors: expanded
      .filter((e) => !e.isSeed)
      .map((e) => ({ ...toBrief(db, e.node), depth: e.depth })),
    resources: collectResources(db, fileIds, filePathOf),
  };
}

/** 所有 tool 结果的联合类型 */
export type ToolResult = ExploreResult | NodeDetailResult | FileInfoResult | RelatedResult;

/**
 * 统一分发：校验入参 → 执行对应 handler → 返回结构化结果。
 * 未知 tool 名或校验失败会抛出 ToolInputError（由 Server 层转为错误响应）。
 */
export async function dispatchTool(
  ctx: ToolContext,
  name: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  switch (name) {
    case "igraph_explore":
      return handleExplore(ctx, validateExploreArgs(rawArgs));
    case "igraph_node":
      return handleNode(ctx, validateNodeArgs(rawArgs));
    case "igraph_file":
      return handleFile(ctx, validateFileArgs(rawArgs));
    case "igraph_related":
      return handleRelated(ctx, validateRelatedArgs(rawArgs));
    default:
      throw new ToolInputError(`未知 tool：${name}`);
  }
}