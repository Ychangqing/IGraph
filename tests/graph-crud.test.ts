/**
 * graph-crud.test.ts — 图谱存储层 Schema/迁移与 CRUD 测试
 *
 * 覆盖：
 * - migrate 幂等（重复调用不报错、版本稳定、表存在）
 * - files upsert
 * - nodes 批量插入
 * - edges 批量插入 + UNIQUE(source,target,kind) 去重
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  openMemoryDatabase,
  closeDatabase,
  migrate,
  getSchemaVersion,
  CURRENT_SCHEMA_VERSION,
  upsertFile,
  upsertFiles,
  countFiles,
  insertNodes,
  countNodes,
  getNodesByFile,
  insertEdges,
  countEdges,
  type DB,
} from "../src/graph/index.js";

let db: DB | undefined;

afterEach(() => {
  if (db) {
    closeDatabase(db);
    db = undefined;
  }
});

describe("schema & migrate", () => {
  it("迁移后版本为 CURRENT_SCHEMA_VERSION 且核心表存在", () => {
    db = openMemoryDatabase();
    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("files");
    expect(tables).toContain("nodes");
    expect(tables).toContain("edges");
    expect(tables).toContain("metadata");
  });

  it("migrate 幂等：重复调用不改变版本、不报错", () => {
    db = openMemoryDatabase();
    const v1 = getSchemaVersion(db);
    migrate(db);
    migrate(db);
    expect(getSchemaVersion(db)).toBe(v1);
  });
});

describe("files CRUD", () => {
  it("upsertFile 按 file_path 幂等（同路径不新增行）", () => {
    db = openMemoryDatabase();
    const id1 = upsertFile(db, { filePath: "src/a.ts", language: "typescript", hash: "h1" });
    const id2 = upsertFile(db, { filePath: "src/a.ts", language: "typescript", hash: "h2" });
    expect(id1).toBe(id2);
    expect(countFiles(db)).toBe(1);
  });

  it("upsertFiles 批量返回 path→id 映射", () => {
    db = openMemoryDatabase();
    const map = upsertFiles(db, [
      { filePath: "src/a.ts", hash: "h1" },
      { filePath: "src/b.ts", hash: "h2" },
    ]);
    expect(map.size).toBe(2);
    expect(map.get("src/a.ts")).toBeTypeOf("number");
    expect(countFiles(db)).toBe(2);
  });
});

describe("nodes CRUD", () => {
  it("批量插入节点返回等长 id 数组，可按文件查询", () => {
    db = openMemoryDatabase();
    const fileId = upsertFile(db, { filePath: "src/a.ts", hash: "h1" });
    const ids = insertNodes(db, [
      { fileId, name: "foo", kind: "function", isExported: true },
      { fileId, name: "bar", kind: "function", isExported: false },
    ]);
    expect(ids).toHaveLength(2);
    expect(countNodes(db)).toBe(2);
    expect(getNodesByFile(db, fileId)).toHaveLength(2);
  });
});

describe("edges CRUD + 去重", () => {
  it("批量插入去重：重复 (source,target,kind) 只保留一条", () => {
    db = openMemoryDatabase();
    const fileId = upsertFile(db, { filePath: "src/a.ts", hash: "h1" });
    const [a, b] = insertNodes(db, [
      { fileId, name: "a", kind: "function" },
      { fileId, name: "b", kind: "function" },
    ]);
    expect(a).toBeTypeOf("number");
    expect(b).toBeTypeOf("number");

    const res = insertEdges(db, [
      { source: a as number, target: b as number, kind: "calls" },
      { source: a as number, target: b as number, kind: "calls" }, // 重复
      { source: a as number, target: b as number, kind: "refs" }, // 不同 kind，保留
    ]);
    expect(res.inserted).toBe(2);
    expect(res.skipped).toBe(1);
    expect(countEdges(db)).toBe(2);
  });

  it("外键约束：source/target 必须为已存在节点", () => {
    db = openMemoryDatabase();
    const fileId = upsertFile(db, { filePath: "src/a.ts", hash: "h1" });
    const [a] = insertNodes(db, [{ fileId, name: "a", kind: "function" }]);
    expect(() =>
      insertEdges(db as DB, [
        { source: a as number, target: 99999, kind: "calls" },
      ]),
    ).toThrow();
  });
});