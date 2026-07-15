/**
 * multimodal/db-schema/parser.ts — DB Schema 解析入口（M7 / 多模态扩展）
 *
 * 职责：识别文件格式，将数据库结构抽取为按表切分的资源切片：
 * - name：表名
 * - content：该表结构的可读文本（DDL 语句 / 表名 + 字段列表）
 * - summary：表名 + 列名清单（供向量化匹配，突出字段语义）
 *
 * 支持格式：
 * - .sql / .ddl：轻量正则提取 `CREATE TABLE`（parseDdl，纯函数）。
 * - .json：结构化 schema，兼容数组 / 对象 / tables 包装等常见形态
 *   （parseJsonSchema，纯函数）。
 * - .xlsx：动态 import `xlsx` 读工作簿，每个 sheet 视为一张表，首行为列名
 *   （parseXlsxWorkbook，纯函数）。
 *
 * 防御式解析：字段/类型缺失容错，解析失败抛可读错误或返回空切片，不裸崩溃。
 * 不做向量化 / 落库。XLSX 抽取涉及异步动态 import，故 parseDbSchema 为 async。
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";

import type { ParseResult, ResourceChunk } from "../types.js";
import { UnsupportedFormatError } from "../types.js";

/** 支持的 DDL 文件扩展名 */
const SQL_EXTENSIONS = new Set([".sql", ".ddl"]);

/** summary 中列清单最大字符数 */
const SUMMARY_COLUMNS_LIMIT = 400;

/** 约束/表级关键字开头的行，不视为列定义 */
const CONSTRAINT_PREFIX =
  /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|KEY|INDEX)\b/i;

/**
 * 匹配 CREATE TABLE 头与其括号体。
 * 捕获组 1 = 表名（可能带 schema 前缀与引号）；后续用括号配平提取表体。
 */
const CREATE_TABLE_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"'[\]\w.]+)\s*\(/gi;

/**
 * 解析 DB Schema 文件为按表切分的资源切片。
 *
 * @param filePath .sql / .ddl / .json / .xlsx 文件路径
 * @throws UnsupportedFormatError 当扩展名不受支持
 * @throws Error 当 JSON/XLSX 内容不可解析
 */
export async function parseDbSchema(filePath: string): Promise<ParseResult> {
  const ext = extname(filePath).toLowerCase();

  if (SQL_EXTENSIONS.has(ext)) {
    const raw = readFileSync(filePath, "utf8");
    return { chunks: parseDdl(raw) };
  }

  if (ext === ".json") {
    const raw = readFileSync(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`解析 JSON Schema 失败（${filePath}）：${reason}`);
    }
    return { chunks: parseJsonSchema(parsed) };
  }

  if (ext === ".xlsx") {
    const chunks = await parseXlsxFile(filePath);
    return { chunks };
  }

  throw new UnsupportedFormatError(
    ext || "(无扩展名)",
    `未知的 DB Schema 文件格式 ${ext || "(无扩展名)"}，仅支持 .sql / .ddl / .json / .xlsx。`,
  );
}

/**
 * 从 DDL 文本中提取所有表切片（纯函数，便于单测）。
 */
export function parseDdl(sql: string): ResourceChunk[] {
  const chunks: ResourceChunk[] = [];
  CREATE_TABLE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = CREATE_TABLE_RE.exec(sql)) !== null) {
    const tableName = normalizeIdentifier(match[1] ?? "");
    if (!tableName) continue;

    // 从匹配到的 "(" 位置开始做括号配平，提取表体。
    const openIndex = CREATE_TABLE_RE.lastIndex - 1;
    const body = extractBalanced(sql, openIndex);
    if (body === null) continue;

    const stmt = `CREATE TABLE ${tableName} (\n${body.trim()}\n);`;
    const columns = extractColumns(body);
    chunks.push({
      name: tableName,
      content: stmt,
      summary: buildSummary(tableName, columns),
    });

    // 让下一轮从表体结束后继续。
    CREATE_TABLE_RE.lastIndex = openIndex + body.length + 1;
  }

  return chunks;
}

/**
 * 从 "(" 处开始做括号配平，返回内部文本（不含最外层括号）；无法配平返回 null。
 */
function extractBalanced(text: string, openIndex: number): string | null {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return text.slice(openIndex + 1, i);
      }
    }
  }
  return null;
}

/**
 * 从表体提取列名（尽力而为）：按顶层逗号切分（忽略括号内的逗号，如
 * DECIMAL(10,2) 或 ENUM(...) ），取每段首个标识符，跳过约束/表级定义行。
 * 这样既支持每列一行，也支持所有列写在同一行的紧凑 DDL。
 */
function extractColumns(body: string): string[] {
  const columns: string[] = [];
  for (const rawSegment of splitTopLevel(body)) {
    const segment = rawSegment.trim();
    if (segment === "") continue;
    if (CONSTRAINT_PREFIX.test(segment)) continue;
    const nameMatch = /^([`"'[\]\w.]+)/.exec(segment);
    if (!nameMatch) continue;
    const col = normalizeIdentifier(nameMatch[1] ?? "");
    if (col) columns.push(col);
  }
  return columns;
}

/**
 * 按顶层逗号切分表体：只在括号深度为 0 处断开，避免误切
 * 类型参数中的逗号（如 DECIMAL(10,2)、ENUM('a','b')）。
 */
function splitTopLevel(body: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth > 0) depth--;
    } else if (ch === "," && depth === 0) {
      segments.push(body.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(body.slice(start));
  return segments;
}

/** 去除标识符外围的引号 / 反引号 / 方括号与 schema 前缀 */
function normalizeIdentifier(raw: string): string {
  const cleaned = raw.replace(/[`"'[\]]/g, "").trim();
  const parts = cleaned.split(".");
  return (parts[parts.length - 1] ?? "").trim();
}

/** 构造表切片摘要：表名 + 列名清单（截断） */
function buildSummary(tableName: string, columns: string[]): string {
  const cols = columns.join(", ");
  const clipped =
    cols.length > SUMMARY_COLUMNS_LIMIT
      ? cols.slice(0, SUMMARY_COLUMNS_LIMIT)
      : cols;
  return clipped ? `表 ${tableName}，字段：${clipped}` : `表 ${tableName}`;
}

// ────────────────────────────────────────────────────────────────────────────
// JSON Schema 解析
// ────────────────────────────────────────────────────────────────────────────

/** 内部中间态：一张表的名称与列清单 */
interface TableSpec {
  name: string;
  columns: string[];
}

/**
 * 从结构化 JSON 对象解析表切片（纯函数，便于单测）。
 *
 * 兼容常见形态：
 * - 数组：`[{ table|name: "users", columns: [...] }, ...]`
 * - 对象包装：`{ tables: { users: { columns: {...}|[...] } } }`
 *   或 `{ tables: [ { name: "users", columns: [...] } ] }`
 * - 顶层映射：`{ users: [...] | { columns: ... } }`
 *
 * columns 兼容：字符串数组 `["id","name"]`、对象数组
 * `[{ name:"id", type:"int" }]`、对象映射 `{ id: "int", name: "text" }`。
 * 缺失字段容错跳过。
 */
export function parseJsonSchema(input: unknown): ResourceChunk[] {
  const specs = collectTableSpecs(input);
  return specs
    .filter((s) => s.name)
    .map((s) => ({
      name: s.name,
      content: buildJsonTableContent(s.name, s.columns),
      summary: buildSummary(s.name, s.columns),
    }));
}

/** 从任意 JSON 结构收敛出表规格列表 */
function collectTableSpecs(input: unknown): TableSpec[] {
  if (Array.isArray(input)) {
    return input.map((item) => toTableSpec(item, undefined)).filter(nonNull);
  }
  if (isPlainObject(input)) {
    // 优先识别 tables 包装。
    if ("tables" in input) {
      const tables = (input as Record<string, unknown>)["tables"];
      if (Array.isArray(tables)) {
        return tables.map((t) => toTableSpec(t, undefined)).filter(nonNull);
      }
      if (isPlainObject(tables)) {
        return Object.entries(tables)
          .map(([name, def]) => toTableSpec(def, name))
          .filter(nonNull);
      }
    }
    // 顶层映射：键为表名，值为列定义。
    return Object.entries(input)
      .map(([name, def]) => toTableSpec(def, name))
      .filter(nonNull);
  }
  return [];
}

/**
 * 将单个表定义规格化。fallbackName 为映射键（顶层/tables 对象场景的表名）。
 */
function toTableSpec(def: unknown, fallbackName: string | undefined): TableSpec | null {
  // 值直接是列数组：`{ users: [...] }`。
  if (Array.isArray(def)) {
    const name = normalizeIdentifier(fallbackName ?? "");
    return { name, columns: extractColumnsFromValue(def) };
  }
  if (isPlainObject(def)) {
    const obj = def as Record<string, unknown>;
    const rawName =
      pickString(obj["table"]) ?? pickString(obj["name"]) ?? fallbackName ?? "";
    const name = normalizeIdentifier(rawName);
    const columns = extractColumnsFromValue(obj["columns"] ?? obj["fields"]);
    return { name, columns };
  }
  return null;
}

/** 从 columns/fields 值（数组或对象映射）提取列名清单 */
function extractColumnsFromValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(columnNameOf).filter((c): c is string => c !== "");
  }
  if (isPlainObject(value)) {
    // 对象映射：键即列名（`{ id: "int" }`）。
    return Object.keys(value).map((k) => normalizeIdentifier(k)).filter(Boolean);
  }
  return [];
}

/** 从单个列定义（字符串 / 对象）取列名 */
function columnNameOf(col: unknown): string {
  if (typeof col === "string") return normalizeIdentifier(col);
  if (isPlainObject(col)) {
    const obj = col as Record<string, unknown>;
    const raw = pickString(obj["name"]) ?? pickString(obj["column"]) ?? "";
    return normalizeIdentifier(raw);
  }
  return "";
}

/** JSON 表切片正文：可读的表名 + 字段清单 */
function buildJsonTableContent(tableName: string, columns: string[]): string {
  if (columns.length === 0) return `表 ${tableName}（无可识别字段）`;
  const lines = columns.map((c) => `  - ${c}`).join("\n");
  return `表 ${tableName}\n字段：\n${lines}`;
}

// ────────────────────────────────────────────────────────────────────────────
// XLSX 解析
// ────────────────────────────────────────────────────────────────────────────

/** xlsx 工作簿的最小结构（避免 any，仅声明用到的部分） */
interface XlsxCell {
  v?: unknown;
}
interface XlsxSheet {
  [cellRef: string]: XlsxCell | unknown;
  "!ref"?: string;
}
interface XlsxWorkbook {
  SheetNames: string[];
  Sheets: Record<string, XlsxSheet>;
}

/**
 * 读取 XLSX 文件并解析为表切片（动态 import xlsx，按需加载）。
 */
async function parseXlsxFile(filePath: string): Promise<ResourceChunk[]> {
  try {
    const mod = await import("xlsx");
    const xlsx = (mod.default ?? mod) as {
      readFile: (path: string) => XlsxWorkbook;
      utils: {
        sheet_to_json: (
          sheet: XlsxSheet,
          opts: { header: 1; blankrows?: boolean },
        ) => unknown[][];
      };
    };
    const workbook = xlsx.readFile(filePath);
    return parseXlsxWorkbook(workbook, (sheet) =>
      xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false }),
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`解析 XLSX 失败（${filePath}）：${reason}`);
  }
}

/**
 * 将工作簿解析为表切片（纯函数，便于单测）。
 *
 * 每个 sheet 视为一张表：sheet 名 = 表名，首行 = 列名（表头）。
 * sheetToRows 负责把 sheet 转成二维行数组（注入以便测试时构造）。
 *
 * @param workbook 工作簿（含 SheetNames / Sheets）
 * @param sheetToRows 将单个 sheet 转为行数组的函数（通常为 xlsx.utils.sheet_to_json）
 */
export function parseXlsxWorkbook(
  workbook: XlsxWorkbook,
  sheetToRows: (sheet: XlsxSheet) => unknown[][],
): ResourceChunk[] {
  const chunks: ResourceChunk[] = [];
  for (const sheetName of workbook.SheetNames) {
    const tableName = normalizeIdentifier(sheetName);
    if (!tableName) continue;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = sheetToRows(sheet);
    const headerRow = rows.length > 0 ? rows[0] : undefined;
    const columns = Array.isArray(headerRow)
      ? headerRow
          .map((cell) => normalizeIdentifier(String(cell ?? "").trim()))
          .filter(Boolean)
      : [];
    chunks.push({
      name: tableName,
      content: buildJsonTableContent(tableName, columns),
      summary: buildSummary(tableName, columns),
    });
  }
  return chunks;
}

// ────────────────────────────────────────────────────────────────────────────
// 通用小工具
// ────────────────────────────────────────────────────────────────────────────

/** 判断是否为普通对象（排除 null / 数组） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 取字符串值，非字符串返回 undefined */
function pickString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** 过滤 null 的类型守卫 */
function nonNull<T>(value: T | null): value is T {
  return value !== null;
}