/**
 * types/index.ts — 解析器与图谱共享的数据类型
 *
 * 说明：
 * - 这些类型与 M2 SQLite Schema（见规划 3.1）对齐，M1 阶段仅在内存中构造。
 * - M1 阶段 node 的 source/target 标识采用「filePath#symbolName」临时字符串，
 *   M2 存储层再映射为数据库自增 id。相关字段在下方注释中明确标注。
 */

/** 节点种类（对应 nodes.kind） */
export type NodeKind =
  | "function"
  | "class"
  | "component"
  | "hook"
  | "type"
  | "variable"
  | "method"
  /**
   * 文件入口节点：代表「文件本身」而非某个具体符号。
   * 作为 imports 边及顶层 calls/refs 边的 source，其 id 为 `${filePath}#*`。
   */
  | "module";

/** 边的种类（对应 edges.kind） */
export type EdgeKind = "calls" | "refs" | "imports" | "extends" | "implements";

/** import 的绑定形式 */
export type ImportKind = "named" | "default" | "namespace" | "require";

/**
 * 代码符号节点（对应 nodes 表）。
 * M1 阶段不含 DB id / summary / embedding 等字段，仅保留解析产出的结构化信息。
 */
export interface CodeNode {
  /** 符号名，如 'getTradeOriginList' */
  name: string;
  /** 符号种类 */
  kind: NodeKind;
  /** 函数/类签名，如 '(params: QueryParams): Promise<PageResult>' */
  signature: string;
  /** 起始行号（1-based） */
  startLine: number;
  /** 结束行号（1-based） */
  endLine: number;
  /** 是否为导出符号 */
  isExported: boolean;
  /** 符号源码（用于后续 LLM 摘要输入） */
  sourceCode: string;
  /** 所属文件的相对路径（相对仓库根） */
  filePath: string;
  /**
   * M1 临时节点标识：`${filePath}#${name}`。
   * M2 存储层写库后会用真实自增 id 替换，此处仅用于内存中建边。
   */
  id: string;
}

/**
 * 节点之间的关系边（对应 edges 表）。
 * source / target 为 M1 临时标识（filePath#symbolName），M2 映射为 DB id。
 */
export interface CodeEdge {
  /** 源节点临时标识（filePath#symbolName） */
  source: string;
  /** 目标节点临时标识（filePath#symbolName） */
  target: string;
  /** 关系种类 */
  kind: EdgeKind;
  /**
   * 弱关系标记：Pass4 通过「全局同名」兜底匹配的调用边标记为 weak，
   * 供 M2+ 做置信度处理。强匹配为 false / undefined。
   */
  weak?: boolean;
}

/** 扫描到的文件（对应 files 表的解析期子集） */
export interface ScannedFile {
  /** 相对仓库根的路径 */
  filePath: string;
  /** 绝对路径 */
  absPath: string;
  /** 语言标识，如 'typescript' | 'javascript' */
  language: string;
  /** 文件源码 */
  sourceCode: string;
}

/** Pass1 产出：导出符号（含名字、种类、签名、行号、源码） */
export interface ExportedSymbol {
  name: string;
  kind: NodeKind;
  signature: string;
  startLine: number;
  endLine: number;
  sourceCode: string;
  /** default export 标记（用于 Pass3 默认导入匹配） */
  isDefault: boolean;
  /** extends 的父类名（class 时可能有） */
  extendsName?: string;
  /** implements 的接口名列表（class 时可能有） */
  implementsNames?: string[];
}

/** Pass2 产出：内部（非导出）顶层符号 */
export interface InternalSymbol {
  name: string;
  kind: NodeKind;
  signature: string;
  startLine: number;
  endLine: number;
  sourceCode: string;
  extendsName?: string;
  implementsNames?: string[];
}

/** Pass3 产出：一条 import 语句解析结果 */
export interface ImportStatement {
  /** 导入来源模块说明符，如 './service' */
  moduleSpecifier: string;
  /** 绑定形式 */
  kind: ImportKind;
  /**
   * 导入的本地名（namespace/default）或 named 绑定列表。
   * - named: 每项 { imported, local }
   * - default/namespace/require: 单项 { imported: '', local }
   */
  bindings: Array<{ imported: string; local: string }>;
  /** 该 import 所在行号 */
  line: number;
}

/** Pass4 产出：一次函数调用表达式 */
export interface CallExpression {
  /** 被调用的函数名（member 调用取属性名，如 a.b() → 'b'） */
  calleeName: string;
  /** 调用点行号 */
  line: number;
  /** 所在的（外层）符号名，用于建 caller→callee 边；顶层调用为 undefined */
  enclosingSymbol?: string;
}

/** Pass5 产出：一次非调用形式的引用（类型引用 / JSX 组件） */
export interface Reference {
  /** 被引用的符号名 */
  name: string;
  /** 引用点行号 */
  line: number;
  /** 所在的（外层）符号名 */
  enclosingSymbol?: string;
  /** 引用来源：'type' 类型注解 | 'jsx' JSX 组件 */
  refKind: "type" | "jsx";
}

/** 解析器整体输出（内存结构，M2 落库） */
export interface ParseResult {
  files: ScannedFile[];
  nodes: CodeNode[];
  edges: CodeEdge[];
}