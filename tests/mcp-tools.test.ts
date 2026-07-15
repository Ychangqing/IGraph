/**
 * mcp-tools.test.ts — MCP tools 输入校验与查询封装测试（P2 / M6）
 *
 * 覆盖：
 * - 输入校验（validateXxxArgs）：必填、类型、范围、枚举、可选默认值；
 * - handler 查询封装（用内存图 seed）：
 *   - handleNode：命中/未命中/同名消歧 + callers/callees；
 *   - handleFile：命中/未命中 + 导出符号筛选；
 *   - handleRelated：callers/callees/both + 未命中；
 *   - handleExplore：无向量时降级为 FTS5 通道（degraded=true）。
 * - dispatchTool：未知 tool 名抛 ToolInputError。
 *
 * 说明：explore 降级路径无需 API Key / 网络；不构造真实 EmbeddingClient。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  openMemoryDatabase,
  closeDatabase,
  upsertFile,
  insertNodes,
  insertEdges,
  type DB,
} from "../src/graph/index.js";
import { loadConfig, ENV_API_KEY, type ResolvedConfig } from "../src/config/index.js";
import { runInit } from "../src/cli/init.js";
import {
  validateExploreArgs,
  validateNodeArgs,
  validateFileArgs,
  validateRelatedArgs,
  handleNode,
  handleFile,
  handleRelated,
  handleExplore,
  dispatchTool,
  ToolInputError,
  type ToolContext,
} from "../src/mcp/tools.js";

// ── 输入校验（纯函数）─────────────────────────────────────────────

describe("validateExploreArgs", () => {
  it("必填 query 缺失或空 → 抛错", () => {
    expect(() => validateExploreArgs({})).toThrow(ToolInputError);
    expect(() => validateExploreArgs({ query: "  " })).toThrow(ToolInputError);
  });

  it("topK/hops 缺省填默认值（5 / 2）", () => {
    const args = validateExploreArgs({ query: "auth" });
    expect(args).toEqual({ query: "auth", topK: 5, hops: 2 });
  });

  it("topK 超范围 → 抛错；非整数 → 抛错", () => {
    expect(() => validateExploreArgs({ query: "q", topK: 0 })).toThrow(ToolInputError);
    expect(() => validateExploreArgs({ query: "q", topK: 51 })).toThrow(ToolInputError);
    expect(() => validateExploreArgs({ query: "q", topK: 1.5 })).toThrow(ToolInputError);
  });

  it("hops 超范围 → 抛错", () => {
    expect(() => validateExploreArgs({ query: "q", hops: 6 })).toThrow(ToolInputError);
    expect(() => validateExploreArgs({ query: "q", hops: -1 })).toThrow(ToolInputError);
  });

  it("非对象入参 → 抛错", () => {
    expect(() => validateExploreArgs(null)).toThrow(ToolInputError);
    expect(() => validateExploreArgs([1])).toThrow(ToolInputError);
  });
});

describe("validateNodeArgs", () => {
  it("仅 name 时不含 file 字段", () => {
    expect(validateNodeArgs({ name: "foo" })).toEqual({ name: "foo" });
  });

  it("file 为空白视为缺省", () => {
    expect(validateNodeArgs({ name: "foo", file: "  " })).toEqual({ name: "foo" });
  });

  it("携带 file 过滤", () => {
    expect(validateNodeArgs({ name: "foo", file: "src/a.ts" })).toEqual({
      name: "foo",
      file: "src/a.ts",
    });
  });

  it("name 缺失 → 抛错", () => {
    expect(() => validateNodeArgs({})).toThrow(ToolInputError);
  });
});

describe("validateFileArgs", () => {
  it("必填 path", () => {
    expect(validateFileArgs({ path: "src/a.ts" })).toEqual({ path: "src/a.ts" });
    expect(() => validateFileArgs({})).toThrow(ToolInputError);
  });
});

describe("validateRelatedArgs", () => {
  it("direction 缺省为 both", () => {
    expect(validateRelatedArgs({ name: "foo" })).toEqual({ name: "foo", direction: "both" });
  });

  it("合法 direction 透传", () => {
    expect(validateRelatedArgs({ name: "foo", direction: "callers" }).direction).toBe("callers");
    expect(validateRelatedArgs({ name: "foo", direction: "callees" }).direction).toBe("callees");
  });

  it("非法 direction → 抛错", () =>{
    expect(() => validateRelatedArgs({ name: "foo", direction: "up" })).toThrow(ToolInputError);
  });
});

// ── handler 查询封装（内存图）────────────────────────────────────────

let db: DB | undefined;
let tmp: string;
let config: ResolvedConfig;

/**
 * 构造固定图：
 *   src/a.ts: main(exported) → helper, main → format
 *   src/b.ts: format
 * 返回节点 id 映射。
 */
function seedGraph(database: DB): { main: number; helper: number; format: number } {
  const fileA = upsertFile(database, { filePath: "src/a.ts", language: "typescript", hash: "ha" });
  const fileB = upsertFile(database, { filePath: "src/b.ts", language: "typescript", hash: "hb" });
  const [main, helper] = insertNodes(database, [
    {
      fileId: fileA,
      name: "main",
      kind: "function",
      signature: "(): void",
      isExported: true,
      sourceCode: "function main() { helper(); format(); }",
      startLine: 1,
      endLine: 3,
    },
    { fileId: fileA, name: "helper", kind: "function", isExported: false },
  ]) as [number, number];
  const [format] = insertNodes(database, [
    { fileId: fileB, name: "format", kind: "function", isExported: true },
  ]) as [number];
  insertEdges(database, [
    { source: main, target: helper, kind: "calls" },
    { source: main, target: format, kind: "calls" },
  ]);
  return { main, helper, format };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "igraph-mcp-"));
  runInit(tmp);
  delete process.env[ENV_API_KEY];
  config = loadConfig(tmp, false); // 降级加载，无需 API Key
  db = openMemoryDatabase();
});

afterEach(() => {
  if (db) {
    closeDatabase(db);
    db = undefined;
  }
  rmSync(tmp, { recursive: true, force: true });
  delete process.env[ENV_API_KEY];
});

function ctx(): ToolContext {
  return { db: db as DB, config };
}

describe("handleNode", () => {
  it("命中：返回详情 + callees（helper/format）", () => {
    seedGraph(db as DB);
    const res = handleNode(ctx(), { name: "main" });
    expect(res.found).toBe(true);
    expect(res.detail?.name).toBe("main");
    expect(res.detail?.filePath).toBe("src/a.ts");
    const callees = (res.detail?.callees ?? []).map((c) => c.name).sort();
    expect(callees).toEqual(["format", "helper"]);
  });

  it("callers：helper 被 main 调用", () => {
    seedGraph(db as DB);
    const res = handleNode(ctx(), { name: "helper" });
    expect(res.detail?.callers.map((c) => c.name)).toEqual(["main"]);
  });

  it("未命中：found=false", () => {
    seedGraph(db as DB);
    const res = handleNode(ctx(), { name: "nope" });
    expect(res.found).toBe(false);
    expect(res.detail).toBeNull();
  });
});

describe("handleFile", () => {
  it("命中：返回节点列表与导出符号", () => {
    seedGraph(db as DB);
    const res = handleFile(ctx(), { path: "src/a.ts" });
    expect(res.found).toBe(true);
    expect(res.info?.nodes.map((n) => n.name).sort()).toEqual(["helper", "main"]);
    expect(res.info?.exportedSymbols.map((n) => n.name)).toEqual(["main"]);
  });

  it("未命中：found=false", () => {
    seedGraph(db as DB);
    const res = handleFile(ctx(), { path: "src/missing.ts" });
    expect(res.found).toBe(false);
    expect(res.info).toBeNull();
  });
});

describe("handleRelated", () => {
  it("callees：main → helper/format", () => {
    seedGraph(db as DB);
    const res = handleRelated(ctx(), { name: "main", direction: "callees" });
    expect(res.found).toBe(true);
 expect(res.neighbors.map((n) => n.name).sort()).toEqual(["format", "helper"]);
  });

  it("callers：format ← main", () => {
    seedGraph(db as DB);
    const res = handleRelated(ctx(), { name: "format", direction: "callers" });
    expect(res.neighbors.map((n) => n.name)).toEqual(["main"]);
  });

  it("未命中符号：found=false", () => {
    seedGraph(db as DB);
    const res = handleRelated(ctx(), { name: "nope", direction: "both" });
    expect(res.found).toBe(false);
    expect(res.neighbors).toHaveLength(0);
  });
});

describe("handleExplore（无向量降级）", () => {
  it("无 node 向量 → degraded=true，走 FTS5 通道", async () => {
    seedGraph(db as DB);
    const res = await handleExplore(ctx(), { query: "helper", topK: 5, hops: 1 });
    expect(res.degraded).toBe(true);
    expect(res.note).toBeTruthy();
    expect(res.tool).toBe("igraph_explore");
  });
});

describe("dispatchTool", () => {
  it("未知 tool 名 → 抛 ToolInputError", async () => {
    await expect(dispatchTool(ctx(), "igraph_unknown", {})).rejects.toBeInstanceOf(ToolInputError);
  });
});