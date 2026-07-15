/**
 * multimodal-parser.test.ts — PRD 切分与 DDL 解析（M7）
 *
 * 覆盖：
 * - chunkMarkdown：按 H1/H2/H3 层级切分；代码围栏内 # 不误判；无标题兜底整篇。
 * - parseDdl：多表提取、表名/列名归一、约束行跳过。
 */
import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "../src/multimodal/prd/chunker.js";
import { parseDdl } from "../src/multimodal/db-schema/parser.js";

describe("chunkMarkdown", () => {
  it("按标题层级切分，子标题并入其父级正文", () => {
    const md = [
      "# 需求一",
      "登录功能说明。",
      "## 子项 1.1",
      "细节。",
      "# 需求二",
      "支付功能说明。",
    ].join("\n");
    const chunks = chunkMarkdown(md);
    expect(chunks.map((c) => c.name)).toEqual(["需求一", "子项 1.1", "需求二"]);
    // 需求一 的 content 含其下 H2 子项内容
    expect(chunks[0]!.content).toContain("子项 1.1");
    // summary 以 name 开头
    expect(chunks[0]!.summary.startsWith("需求一")).toBe(true);
  });

  it("代码围栏内的 # 不被当作标题", () => {
    const md = [
      "# 真标题",
      "```py",
      "# 这是注释不是标题",
      "x = 1",
      "```",
      "正文。",
    ].join("\n");
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.name).toBe("真标题");
  });

  it("H4 及更深层级不作为切分点", () => {
    const md = ["# H1", "#### H4 深层", "内容。"].join("\n");
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.name).toBe("H1");
  });

  it("无任何标题时整篇作为一个切片，用兜底名", () => {
    const chunks = chunkMarkdown("纯正文没有标题。", "MyDoc");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.name).toBe("MyDoc");
  });

  it("空文档返回空数组", () => {
    expect(chunkMarkdown("   \n  \n")).toEqual([]);
  });
});

describe("parseDdl", () => {
  it("提取多张表，每表一个切片", () => {
    const sql = [
      "CREATE TABLE users (",
      "  id INTEGER PRIMARY KEY,",
      "  name TEXT NOT NULL,",
      "  email TEXT",
      ");",
      "CREATE TABLE IF NOT EXISTS orders (",
      "  id INTEGER PRIMARY KEY,",
      "  user_id INTEGER,",
      "  FOREIGN KEY (user_id) REFERENCES users(id)",
      ");",
    ].join("\n");
    const chunks = parseDdl(sql);
    expect(chunks.map((c) => c.name)).toEqual(["users", "orders"]);
    // content 保留 CREATE TABLE 语句
    expect(chunks[0]!.content).toContain("CREATE TABLE users");
    // summary 含字段名，且不含约束行提取出的伪列
    expect(chunks[0]!.summary).toContain("name");
    expect(chunks[0]!.summary).toContain("email");
    expect(chunks[1]!.summary).not.toContain("FOREIGN");
  });

  it("去除反引号/方括号与 schema 前缀", () => {
    const sql = "CREATE TABLE `db`.`t_item` (`id` INT, `title` TEXT);";
    const chunks = parseDdl(sql);
    expect(chunks[0]!.name).toBe("t_item");
    expect(chunks[0]!.summary).toContain("id");
    expect(chunks[0]!.summary).toContain("title");
  });

  it("无 CREATE TABLE 返回空", () => {
    expect(parseDdl("SELECT 1;")).toEqual([]);
  });
});