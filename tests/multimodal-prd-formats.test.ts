/**
 * multimodal-prd-formats.test.ts — PRD 多格式解析路由（PDF/DOCX/DOC/文本）
 *
 * 覆盖：
 * - 格式路由：.txt 走文本；.doc 抛 UnsupportedFormatError；未知扩展名抛错。
 * - PDF/DOCX：mock pdf-parse / mammoth 动态 import，验证「抽取文本 →
 *   chunkMarkdown」链路正确（含标题切分）。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parsePrd } from "../src/multimodal/prd/parser.js";
import { UnsupportedFormatError } from "../src/multimodal/types.js";

// mock 重依赖的动态 import：抽取器返回可控文本，验证下游切分链路。
vi.mock("pdf-parse", () => ({
  default: vi.fn(async () => ({ text: "# PDF 需求\n登录说明。" })),
}));
vi.mock("mammoth", () => ({
  default: {
    extractRawText: vi.fn(async () => ({ value: "# DOCX 需求\n支付说明。" })),
  },
}));

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "igraph-prd-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("parsePrd 格式路由", () => {
  it(".txt 走文本路径，交给 chunkMarkdown", async () => {
    const file = join(tmp, "req.txt");
    writeFileSync(file, "# 标题\n正文内容。", "utf8");
    const { chunks } = await parsePrd(file);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.name).toBe("标题");
  });

  it(".doc 旧格式抛 UnsupportedFormatError", async () => {
    const file = join(tmp, "old.doc");
    writeFileSync(file, "dummy", "utf8");
    await expect(parsePrd(file)).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    );
  });

  it("未知扩展名抛 UnsupportedFormatError", async () => {
    const file = join(tmp, "weird.xyz");
    writeFileSync(file, "dummy", "utf8");
    await expect(parsePrd(file)).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    );
  });
});

describe("parsePrd PDF/DOCX 抽取链路", () => {
  it(".pdf 抽取文本后按标题切分", async () => {
    const file = join(tmp, "spec.pdf");
    writeFileSync(file, "%PDF-1.4 dummy", "utf8");
    const { chunks } = await parsePrd(file);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.name).toBe("PDF 需求");
    expect(chunks[0]!.content).toContain("登录说明");
  });

  it(".docx 抽取文本后按标题切分", async () => {
    const file = join(tmp, "spec.docx");
    writeFileSync(file, "PK dummy", "utf8");
    const { chunks } = await parsePrd(file);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.name).toBe("DOCX 需求");
    expect(chunks[0]!.content).toContain("支付说明");
  });
});