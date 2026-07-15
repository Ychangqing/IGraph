/**
 * multimodal/prd/parser.ts — PRD 文档解析入口（M7 / 多模态扩展）
 *
 * 职责：根据文件扩展名识别格式，抽取纯文本并交给 chunker 切分为需求点切片。
 * - .md / .markdown / .txt：直接读文本。
 * - .pdf：动态 import `pdf-parse` 抽取纯文本（按需加载，未挂载 PDF 时零开销）。
 * - .docx：动态 import `mammoth` 的 extractRawText 抽取纯文本。
 * - .doc（旧二进制格式，mammoth 不支持）：抛 UnsupportedFormatError，提示转为
 *   .docx / .md。
 * - 其它未知格式：抛 UnsupportedFormatError。
 *
 * 抽取失败（文件损坏 / 库异常）抛带可读信息的错误；抽取到空文本时返回空 chunks
 * 并由上层给出「未解析出切片」的友好提示，不裸崩溃。
 *
 * 不做向量化 / 落库，仅负责「文件 → ResourceChunk[]」。抽取环节涉及异步 I/O，
 * 故 parsePrd 为 async。
 */
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

import type { ParseResult } from "../types.js";
import { UnsupportedFormatError } from "../types.js";
import { chunkMarkdown } from "./chunker.js";

/** 直接按纯文本读的扩展名 */
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

/**
 * 解析 PRD 文件为需求点切片。
 *
 * @param filePath PRD 文件绝对/相对路径
 * @throws UnsupportedFormatError 当扩展名为 .doc 或其它未知非文本格式
 * @throws Error 当 PDF/DOCX 抽取过程发生不可恢复错误
 */
export async function parsePrd(filePath: string): Promise<ParseResult> {
  const ext = extname(filePath).toLowerCase();
  const fallbackName = fileBaseName(filePath);

  if (TEXT_EXTENSIONS.has(ext)) {
    const raw = readFileSync(filePath, "utf8");
    return { chunks: chunkMarkdown(raw, fallbackName) };
  }

  if (ext === ".pdf") {
    const text = await extractPdfText(filePath);
    return { chunks: chunkMarkdown(text, fallbackName) };
  }

  if (ext === ".docx") {
    const text = await extractDocxText(filePath);
    return { chunks: chunkMarkdown(text, fallbackName) };
  }

  if (ext === ".doc") {
    throw new UnsupportedFormatError(
      ext,
      "暂不支持解析旧版 .doc 二进制格式，请先另存为 .docx 或 .md 后再挂载。",
    );
  }

  throw new UnsupportedFormatError(
    ext || "(无扩展名)",
    `未知的 PRD 文件格式 ${ext || "(无扩展名)"}，仅支持 .md / .markdown / .txt / .pdf / .docx。`,
  );
}

/**
 * 用 pdf-parse 抽取 PDF 纯文本（动态 import，按需加载）。
 * 其包入口的调试代码仅在 `require.main === module` 时执行，动态 import 不会触发，
 * 因此可安全导入主入口以复用 @types/pdf-parse 的类型声明。
 */
async function extractPdfText(filePath: string): Promise<string> {
  try {
    const mod = await import("pdf-parse");
    const pdfParse = (mod.default ?? mod) as (
      data: Buffer,
    ) => Promise<{ text: string }>;
    const buffer = readFileSync(filePath);
    const result = await pdfParse(buffer);
    return result.text ?? "";
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`解析 PDF 失败（${filePath}）：${reason}`);
  }
}

/**
 * 用 mammoth 抽取 DOCX 纯文本（动态 import，按需加载）。
 */
async function extractDocxText(filePath: string): Promise<string> {
  try {
    const mod = await import("mammoth");
    const mammoth = (mod.default ?? mod) as {
      extractRawText: (input: { path: string }) => Promise<{ value: string }>;
    };
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value ?? "";
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`解析 DOCX 失败（${filePath}）：${reason}`);
  }
}

/** 取不含扩展名的文件名，作为无标题时的兜底切片名 */
function fileBaseName(filePath: string): string {
  const base = basename(filePath);
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}