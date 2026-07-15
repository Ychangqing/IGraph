/**
 * multimodal/prd/chunker.ts — PRD Markdown 按标题层级切分为需求点（M7）
 *
 * 策略：
 * - 扫描 Markdown 的 ATX 标题（# / ## / ###，最多到 H3），以每个标题为一个
 *   需求点切片的起点，正文为该标题行到下一个「同级或更高级」标题之前的全部
 *   内容（含更深层级的子标题与其正文，保留完整上下文）。
 * - name 取标题文本；content 为标题 + 其正文；summary 为 name + 正文前若干字符
 *   （截断，控制向量化 token）。
 * - 无任何标题时：整篇文档作为单一切片（name 取文件名或首行）。
 * - 代码围栏（``` ... ```）内的 # 不被误判为标题。
 *
 * 纯函数（输入 Markdown 文本 → 切片列表），便于单测；不做 I/O。
 */
import type { ResourceChunk } from "../types.js";

/** summary 截取的正文最大字符数 */
const SUMMARY_BODY_LIMIT = 300;

/** 最大切分标题层级（H1~H3） */
const MAX_HEADING_LEVEL = 3;

/** 匹配 ATX 标题：1~6 个 #，后随空格与标题文本 */
const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;

/** 一个中间态的标题节点 */
interface HeadingSpan {
  level: number;
  title: string;
  /** 起始行索引（标题行） */
  start: number;
}

/**
 * 将 PRD Markdown 文本按标题层级切分为需求点切片。
 *
 * @param markdown PRD 全文
 * @param fallbackName 无标题时的切片名（通常为文件名）
 */
export function chunkMarkdown(
  markdown: string,
  fallbackName = "PRD",
): ResourceChunk[] {
  const lines = markdown.split(/\r?\n/);

  // 先定位所有「可切分」标题（H1~H3，排除代码围栏内）。
  const headings: HeadingSpan[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = HEADING_RE.exec(line);
    if (m && m[1] && m[2]) {
      const level = m[1].length;
      if (level <= MAX_HEADING_LEVEL) {
        headings.push({ level, title: m[2].trim(), start: i });
      }
    }
  }

  // 无标题：整篇作为单一切片。
  if (headings.length === 0) {
    const content = markdown.trim();
    if (content === "") return [];
    return [makeChunk(fallbackName, content)];
  }

  const chunks: ResourceChunk[] = [];
  for (let h = 0; h < headings.length; h++) {
    const cur = headings[h]!;
    // 正文终点：下一个「同级或更高级（level <= cur.level）」标题的起始行。
    let end = lines.length;
    for (let k = h + 1; k < headings.length; k++) {
      if (headings[k]!.level <= cur.level) {
        end = headings[k]!.start;
        break;
      }
    }
    const body = lines.slice(cur.start, end).join("\n").trim();
    if (body === "") continue;
    chunks.push(makeChunk(cur.title, body));
  }

  return chunks;
}

/** 组装一个切片：name + content + 截断 summary */
function makeChunk(name: string, content: string): ResourceChunk {
  return {
    name,
    content,
    summary: buildSummary(name, content),
  };
}

/**
 * 构造向量化用摘要：name + 去除标题行后的正文前 N 字符。
 * 折叠连续空白，避免 Markdown 语法噪声占用 token。
 */
function buildSummary(name: string, content: string): string {
  // 去掉正文首行的标题标记，取其余正文。
  const bodyLines = content.split(/\r?\n/);
  const rest = bodyLines
    .slice(1)
    .join(" ")
    .replace(/[#>*`_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const clipped =
    rest.length > SUMMARY_BODY_LIMIT
      ? rest.slice(0, SUMMARY_BODY_LIMIT)
      : rest;
  return clipped ? `${name}. ${clipped}` : name;
}