/**
 * fts5-search.test.ts — FTS5 全文检索通道
 *
 * 覆盖：
 * - toFtsMatchExpr 词元转义（空/纯符号返回 null，≥3 字符词元用双引号 OR 连接，
 *   <3 字符短词元被过滤出 MATCH 表达式）；
 * - searchFts 命中 nodes_fts（由触发器随 nodes 插入/摘要更新同步）；
 * - trigram 分词器下英文标识符子串匹配（getTradeOriginList）；
 * - trigram 分词器下中文摘要子串匹配（"查询交易溯源列表数据" 命中 "溯源列表"）；
 * - <3 字符中文短查询（"溯源"）经 LIKE 兜底命中；
 * - 返回带 0 基 rank，按 bm25 排序（越小越相关）。
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  openMemoryDatabase,
  closeDatabase,
  upsertFile,
  insertNodes,
  updateNodeSummaries,
  type DB,
} from "../src/graph/index.js";
import { toFtsMatchExpr, searchFts } from "../src/retrieval/fts5-search.js";

let db: DB | undefined;
afterEach(() => {
  if (db) {
    closeDatabase(db);
    db = undefined;
  }
});

describe("toFtsMatchExpr - 查询转义", () => {
  it("≥3 字符词元用双引号包裹并 OR 连接", () => {
    const expr = toFtsMatchExpr("user login");
    expect(expr).toBe('"user" OR "login"');
  });

  it("空或纯符号查询返回 null", () => {
    expect(toFtsMatchExpr("")).toBeNull();
    expect(toFtsMatchExpr("!@#$%")).toBeNull();
  });

  it("保留字母数字下划线，剔除标点（防注入）", () => {
    const expr = toFtsMatchExpr("get_user() AND drop");
    expect(expr).toBe('"get_user" OR "AND" OR "drop"');
  });

  it("过滤 <3 字符短词元（trigram 无法索引，交由 LIKE 兜底）", () => {
    // "溯源" 为 2 汉字 -> 被过滤；无 ≥3 字符词元时返回 null
    expect(toFtsMatchExpr("溯源")).toBeNull();
    // 混合：短词元被过滤，仅保留 ≥3 字符词元
    expect(toFtsMatchExpr("溯源 交易溯源")).toBe('"交易溯源"');
  });
});

describe("searchFts - 全文检索（trigram）", () => {
  it("命中包含查询词的节点，返回带 0 基 rank", () => {
    db = openMemoryDatabase();
    const fileId = upsertFile(db, { filePath: "src/a.ts", hash: "h1" });
    insertNodes(db, [
      { fileId, name: "authenticateUser", kind: "function" },
      { fileId, name: "renderList", kind: "function" },
      { fileId, name: "parseConfig", kind: "function" },
    ]);

    const hits = searchFts(db, "authenticateUser", 10);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.rank).toBe(0);
    expect(hits[0]!.nodeId).toBe(1);
  });

  it("英文标识符子串匹配不回退（Origin 命中 getTradeOriginList）", () => {
    db = openMemoryDatabase();
    const fileId = upsertFile(db, { filePath: "src/b.ts", hash: "h2" });
    const ids = insertNodes(db, [
      { fileId, name: "getTradeOriginList", kind: "function" },
      { fileId, name: "renderList", kind: "function" },
    ]);

    // 全名精确检索仍命中
    const full = searchFts(db, "getTradeOriginList", 10);
    expect(full.map((h) => h.nodeId)).toContain(ids[0]);

    // 子串检索（trigram 特性）命中
    const sub = searchFts(db, "Origin", 10);
    expect(sub.map((h) => h.nodeId)).toContain(ids[0]);
  });

  it("中文摘要子串匹配（≥3 字符经 MATCH 命中）", () => {
    db = openMemoryDatabase();
    const fileId = upsertFile(db, { filePath: "src/c.ts", hash: "h3" });
    const ids = insertNodes(db, [
      { fileId, name: "getTradeOriginList", kind: "function" },
      { fileId, name: "renderList", kind: "function" },
    ]);
    // 通过摘要更新写入中文摘要，nodes_au 触发器同步到 FTS
    updateNodeSummaries(db, [
      {
        nodeId: ids[0]!,
        summary: "查询交易溯源列表数据",
        status: "done",
        model: null,
        promptVersion: null,
      },
    ]);

    // "溯源列表"（4 汉字，≥3）经 trigram MATCH 命中中文摘要
    const hits = searchFts(db, "溯源列表", 10);
    expect(hits.map((h) => h.nodeId)).toContain(ids[0]);
  });

  it("中文短查询（<3 字符）经 LIKE 兜底命中", () => {
    db = openMemoryDatabase();
    const fileId = upsertFile(db, { filePath: "src/d.ts", hash: "h4" });
    const ids = insertNodes(db, [
      { fileId, name: "getTradeOriginList", kind: "function" },
      { fileId, name: "renderList", kind: "function" },
    ]);
    updateNodeSummaries(db, [
      {
        nodeId: ids[0]!,
        summary: "查询交易溯源列表数据",
        status: "done",
        model: null,
        promptVersion: null,
      },
    ]);

    // "溯源"（2 汉字）trigram 无法索引，LIKE 兜底命中
    const hits = searchFts(db, "溯源", 10);
    expect(hits.map((h) => h.nodeId)).toContain(ids[0]);
  });

  it("无匹配词返回空", () => {
    db = openMemoryDatabase();
    const fileId = upsertFile(db, { filePath: "src/a.ts", hash: "h1" });
    insertNodes(db, [{ fileId, name: "foo", kind: "function" }]);
    expect(searchFts(db, "nonexistentterm", 10)).toEqual([]);
  });

  it("空查询返回空", () => {
    db = openMemoryDatabase();
    expect(searchFts(db, "", 10)).toEqual([]);
  });
});