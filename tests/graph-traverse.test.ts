/**
 * graph-traverse.test.ts — 图遍历（递归 CTE）与落库（ingest）测试
 *
 * 覆盖：
 * - N 跳遍历的方向（callees/callers/both）
 * - 边类型过滤
 * - maxHops 深度限制
 * - 环安全（不无限递归）
 * - ingestParseResult 将临时标识映射为 DB id、imports 占位边跳过
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  openMemoryDatabase,
  closeDatabase,
  upsertFile,
  insertNodes,
  insertEdges,
  traverse,
  ingestParseResult,
  countFiles,
  countNodes,
  countEdges,
  type DB,
} from "../src/graph/index.js";
import type { ParseResult } from "../src/types/index.js";

let db: DB | undefined;

afterEach(() => {
  if (db) {
    closeDatabase(db);
    db = undefined;
  }
});

/**
 * 构造一张固定图：a → b → c，a → d（均为 calls），外加 a →refs→ b。
 * 返回节点 id 映射。
 */
function seedGraph(database: DB): { a: number; b: number; c: number; d: number } {
 const fileId = upsertFile(database, { filePath: "src/g.ts", hash: "h" });
  const [a, b, c, d] = insertNodes(database, [
    { fileId, name: "a", kind: "function" },
    { fileId, name: "b", kind: "function" },
    { fileId, name: "c", kind: "function" },
    { fileId, name: "d", kind: "function" },
  ]) as [number, number, number, number];
  insertEdges(database, [
    { source: a, target: b, kind: "calls" },
    { source: b, target: c, kind: "calls" },
    { source: a, target: d, kind: "calls" },
    { source: a, target: b, kind: "refs" },
  ]);
  return { a, b, c, d };
}

describe("traverse - 方向", () => {
  it("callees：从 a 出发 2 跳可达 b/c/d", () => {
    db = openMemoryDatabase();
    const { a } = seedGraph(db);
    const hits = traverse(db, { startId: a, direction: "callees", maxHops: 2 });
    const names = hits.map((h) => h.node.name).sort();
    expect(names).toEqual(["b", "c", "d"]);
  });

  it("callees maxHops=1：从 a 仅可达 b/d（不含 c）", () => {
    db = openMemoryDatabase();
    const { a } = seedGraph(db);
    const hits = traverse(db, { startId: a, direction: "callees", maxHops: 1 });
    const names = hits.map((h) => h.node.name).sort();
    expect(names).toEqual(["b", "d"]);
  });

  it("callers：从 c 回溯可达 b（1跳）与 a（2跳）", () => {
    db = openMemoryDatabase();
    const { c } = seedGraph(db);
    const hits = traverse(db, { startId: c, direction: "callers", maxHops: 2 });
    const depthByName = new Map(hits.map((h) => [h.node.name, h.depth]));
    expect(depthByName.get("b")).toBe(1);
    expect(depthByName.get("a")).toBe(2);
  });

  it("both：从 b 出发双向可达 a（入）与 c（出）", () => {
    db = openMemoryDatabase();
    const { b } = seedGraph(db);
    const hits = traverse(db, { startId: b, direction: "both", maxHops: 1 });
    const names = hits.map((h) => h.node.name).sort();
    expect(names).toContain("a");
    expect(names).toContain("c");
  });
});

describe("traverse - 边类型过滤", () => {
  it("仅沿 refs 边扩展时，从 a 只可达 b（refs），不含 d", () => {
    db = openMemoryDatabase();
    const { a } = seedGraph(db);
    const hits = traverse(db, {
      startId: a,
      direction: "callees",
      maxHops: 2,
      edgeKinds: ["refs"],
    });
    const names = hits.map((h) => h.node.name).sort();
    expect(names).toEqual(["b"]);
  });
});

describe("traverse - 环安全", () => {
  it("存在环 a→b→a 时不无限递归", () => {
    db = openMemoryDatabase();
    const fileId = upsertFile(db, { filePath: "src/cycle.ts", hash: "h" });
    const [a, b] = insertNodes(db, [
      { fileId, name: "a", kind: "function" },
      { fileId, name: "b", kind: "function" },
    ]) as [number, number];
    insertEdges(db, [
      { source: a, target: b, kind: "calls" },
      { source: b, target: a, kind: "calls" },
    ]);
    const hits = traverse(db, { startId: a, direction: "callees", maxHops: 5 });
    // 只应命中 b（a 是起点，默认不含自身）
    expect(hits.map((h) => h.node.name)).toEqual(["b"]);
  });
});

describe("ingestParseResult", () => {
  it("将 ParseResult 落库并映射临时标识为 DB id", () => {
    db = openMemoryDatabase();
    const parse: ParseResult = {
      files: [
        {
          filePath: "src/x.ts",
          absPath: "/abs/src/x.ts",
          language: "typescript",
          sourceCode: "export function foo(){ bar(); }\nfunction bar(){}",
        },
      ],
      nodes: [
        {
          id: "src/x.ts#*",
          name: "src/x.ts",
          kind: "module",
          signature: "",
          startLine: 1,
          endLine: 1,
          isExported: false,
          sourceCode: "",
          filePath: "src/x.ts",
        },
        {
          id: "src/x.ts#foo",
          name: "foo",
          kind: "function",
          signature: "()",
          startLine: 1,
          endLine: 1,
          isExported: true,
          sourceCode: "function foo(){ bar(); }",
          filePath: "src/x.ts",
        },
        {
          id: "src/x.ts#bar",
          name: "bar",
          kind: "function",
          signature: "()",
          startLine: 2,
          endLine: 2,
          isExported: false,
          sourceCode: "function bar(){}",
          filePath: "src/x.ts",
        },
      ],
      edges: [
        { source: "src/x.ts#foo", target: "src/x.ts#bar", kind: "calls" },
        // imports 边：source 为文件入口节点 `filePath#*`（已落库）→ 可正常解析
        { source: "src/x.ts#*", target: "src/x.ts#bar", kind: "imports" },
      ],
    };

    const res = ingestParseResult(db, parse);
    expect(res.files).toBe(1);
    expect(res.nodes).toBe(3); // module + foo + bar
    expect(res.edges).toBe(2); // calls + imports 均成功
    expect(res.edgesUnresolved).toBe(0); // 文件入口节点已落库，imports 可解析
    expect(countFiles(db)).toBe(1);
    expect(countNodes(db)).toBe(3);
    expect(countEdges(db)).toBe(2);
  });

  it("两端无法映射的边计入 edgesUnresolved 并跳过", () => {
    db = openMemoryDatabase();
    const parse: ParseResult = {
      files: [
        {
          filePath: "src/y.ts",
          absPath: "/abs/src/y.ts",
          language: "typescript",
          sourceCode: "export function foo(){}",
        },
      ],
      nodes: [
        {
          id: "src/y.ts#foo",
          name: "foo",
          kind: "function",
          signature: "()",
          startLine: 1,
          endLine: 1,
          isExported: true,
          sourceCode: "function foo(){}",
          filePath: "src/y.ts",
        },
      ],
      edges: [
        // target 指向未落库的符号 → 无法解析
        { source: "src/y.ts#foo", target: "src/z.ts#missing", kind: "imports" },
      ],
    };

    const res = ingestParseResult(db, parse);
    expect(res.edges).toBe(0);
    expect(res.edgesUnresolved).toBe(1);
  });
});