/**
 * multimodal-db-formats.test.ts — DB Schema JSON / XLSX 解析（多模态扩展）
 *
 * 覆盖：
 * - parseJsonSchema：数组形态、tables 对象包装形态；列定义容错（字符串/对象/映射）。
 * - parseXlsxWorkbook：每个 sheet 一张表，首行为列名。
 */
import * as XLSX from "xlsx";
import { describe, it, expect } from "vitest";

import {
  parseJsonSchema,
  parseXlsxWorkbook,
} from "../src/multimodal/db-schema/parser.js";

describe("parseJsonSchema — 数组形态", () => {
  it("数组 + 对象列定义，生成每表切片", () => {
    const input = [
      {
        table: "users",
        columns: [
          { name: "id", type: "int" },
          { name: "email", type: "text" },
        ],
      },
      {
        name: "orders",
        columns: ["id", "user_id", "amount"],
      },
    ];
    const chunks = parseJsonSchema(input);
    expect(chunks.map((c) => c.name)).toEqual(["users", "orders"]);
    expect(chunks[0]!.summary).toContain("email");
    expect(chunks[0]!.content).toContain("表 users");
    expect(chunks[1]!.summary).toContain("user_id");
    expect(chunks[1]!.summary).toContain("amount");
  });

  it("列定义缺失字段时容错跳过", () => {
    const input = [
      { table: "t1", columns: ["a", { type: "int" }, "b"] },
    ];
    const chunks = parseJsonSchema(input);
    expect(chunks[0]!.summary).toContain("a");
    expect(chunks[0]!.summary).toContain("b");
  });
});

describe("parseJsonSchema — 对象形态", () => {
  it("tables 对象包装 + 列映射", () => {
    const input = {
      tables: {
        products: {
          columns: { id: "int", title: "text", price: "decimal" },
        },
      },
    };
    const chunks = parseJsonSchema(input);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.name).toBe("products");
    expect(chunks[0]!.summary).toContain("title");
    expect(chunks[0]!.summary).toContain("price");
  });

  it("顶层映射：键为表名，值为列数组", () => {
    const input = { logs: ["ts", "level", "message"] };
    const chunks = parseJsonSchema(input);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.name).toBe("logs");
    expect(chunks[0]!.summary).toContain("level");
  });

  it("非对象/数组输入返回空数组", () => {
    expect(parseJsonSchema(null)).toEqual([]);
    expect(parseJsonSchema(42)).toEqual([]);
  });
});

describe("parseXlsxWorkbook", () => {
  it("每个 sheet 视为一张表，首行为列名", () => {
    // 用 xlsx 库在内存中构造工作簿：两个 sheet。
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet([
      ["id", "name", "email"],
      [1, "alice", "a@x.com"],
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([
      ["order_id", "total"],
      [100, 9.9],
    ]);
    XLSX.utils.book_append_sheet(wb, ws1, "users");
    XLSX.utils.book_append_sheet(wb, ws2, "orders");

    const chunks = parseXlsxWorkbook(
      wb as unknown as Parameters<typeof parseXlsxWorkbook>[0],
      (sheet) =>
        XLSX.utils.sheet_to_json(sheet as XLSX.WorkSheet, {
          header: 1,
          blankrows: false,
        }),
    );

    expect(chunks.map((c) => c.name)).toEqual(["users", "orders"]);
    expect(chunks[0]!.summary).toContain("name");
    expect(chunks[0]!.summary).toContain("email");
    expect(chunks[1]!.summary).toContain("order_id");
    expect(chunks[1]!.summary).toContain("total");
  });
});