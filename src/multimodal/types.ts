/**
 * multimodal/types.ts — 多模态挂载共享类型（M7）
 *
 * 定义解析 / 切分阶段产出的资源切片结构，供 prd / db-schema 子模块与
 * 挂载主流程（index.ts）、linker 复用。每个切片是一个可独立向量化的
 * 语义单元。
 */

/** 一个可挂载的资源切片（PRD 需求点 / DB 表等） */
export interface ResourceChunk {
  /** 切片名（如需求点标题、表名） */
  name: string;
  /** 切片正文（用于展示与回溯） */
  content: string;
  /** 用于向量化的精简摘要（通常为 name + 关键正文，控制 token） */
  summary: string;
}

/** 解析器的解析结果 */
export interface ParseResult {
  /** 解析出的切片列表 */
  chunks: ResourceChunk[];
}

/**
 * 不支持的格式错误：用于 pdf/docx 等尚未打通的格式，给出友好可读的报错，
 * 而非崩溃或抛出裸 Error。
 */
export class UnsupportedFormatError extends Error {
  /** 触发错误的文件扩展名（含点，如 ".pdf"） */
  readonly ext: string;

  constructor(ext: string, message: string) {
    super(message);
    this.name = "UnsupportedFormatError";
    this.ext = ext;
  }
}