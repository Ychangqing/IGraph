/**
 * incremental/diff-detector.ts — 基于内容哈希的变更检测
 *
 * 以数据库 files 表的 hash 字段为「上一次构建快照」，与当前工作区
 * 重新扫描后计算的文件哈希做对比，产出四类变更：
 *   - added：新出现的文件（DB 中无该路径）
 *   - modified：路径已存在但内容哈希变化
 *   - deleted：DB 中存在但工作区已消失的路径
 *   - renamed：内容哈希相同但路径变化（deleted 与 added 通过 hash 配对识别）
 *
 * 不依赖 `git`：git 未初始化 / 未提交的场景同样可用；哈希算法与
 * graph/ingest.ts 的 hashContent 保持一致（sha256(sourceCode, utf8)），
 * 确保与全量落库写入 files.hash 的口径完全对齐。
 *
 * rename 识别：deleted 集合中的某个 hash 恰好等于 added 集合中某文件的 hash，
 * 且该 hash 在两侧均唯一（避免多个同哈希文件产生歧义配对）时，判定为重命名。
 * 一旦配对为 rename，则从 added / deleted 中移除，只保留一条 {from, to}。
 */
import { createHash } from "node:crypto";

import type { DB } from "../graph/db.js";
import { listFiles } from "../graph/files.js";
import { scanFiles } from "../parser/file-scanner.js";

/** 一次重命名：from（旧路径）→ to（新路径），内容不变 */
export interface RenamedFile {
  from: string;
  to: string;
}

/** 变更检测结果 */
export interface ChangeSet {
  /** 新增文件（工作区新出现，且非重命名而来） */
  added: string[];
  /** 修改文件（路径已存在，内容哈希变化） */
  modified: string[];
  /** 删除文件（DB 存在、工作区消失，且非被重命名走） */
  deleted: string[];
  /** 重命名（内容哈希相同、路径变化） */
  renamed: RenamedFile[];
}

/** 扫描选项（复用 parser 的 include/exclude glob） */
export interface DetectChangesOptions {
  root: string;
  include: string[];
  exclude: string[];
}

/** 计算源码内容哈希（与 graph/ingest.ts 的 hashContent 完全一致） */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * 判断变更集是否为空（无任何增删改，也无重命名）。
 */
export function isEmptyChangeSet(changes: ChangeSet): boolean {
  return (
    changes.added.length === 0 &&
    changes.modified.length === 0 &&
    changes.deleted.length === 0 &&
    changes.renamed.length === 0
  );
}

/**
 * 检测工作区相对数据库快照的变更。
 *
 * 依赖注入友好仅消费 db 与文件扫描结果，不触碰网络 / LLM，便于测试。
 *
 * @param db      已打开且完成迁移的数据库连接（提供上一次构建快照）
 * @param options 扫描范围（root/include/exclude，与 build 复用同一份配置）
 */
export async function detectChanges(
  db: DB,
  options: DetectChangesOptions,
): Promise<ChangeSet> {
  const { root, include, exclude } = options;

  // 上一次快照：DB files 表的 path → hash。
  const dbFiles = listFiles(db);
  const dbHashByPath = new Map<string, string>();
  for (const f of dbFiles) dbHashByPath.set(f.file_path, f.hash);

  // 当前工作区：重新扫描并计算 path → hash。
  const scanned = await scanFiles({ root, include, exclude });
  const curHashByPath = new Map<string, string>();
  for (const s of scanned) curHashByPath.set(s.filePath, hashContent(s.sourceCode));

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  // 当前、DB 有 → 比哈希判断 modified；当前有、DB 无 → added（候选）。
  for (const [path, hash] of curHashByPath) {
    const prev = dbHashByPath.get(path);
    if (prev === undefined) {
      added.push(path);
    } else if (prev !== hash) {
      modified.push(path);
    }
  }

  // DB 有、当前无 → deleted（候选）。
  for (const path of dbHashByPath.keys()) {
    if (!curHashByPath.has(path)) deleted.push(path);
  }

  // ── rename 配对：deleted 的 hash 在 added 中唯一出现即判定为重命名 ──
  const renamed = pairRenames(added, deleted, dbHashByPath, curHashByPath);

  return {
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort(),
    renamed,
  };
}

/**
 * 在 added / deleted 候选集中按内容哈希配对重命名。
 * 命中后就地从 added / deleted 数组移除，返回配对列表。
 *
 * 仅当某哈希在 deleted 侧与 added 侧都恰好唯一出现时才配对，避免多个同哈希
 * 文件（如空文件、样板文件）造成的错误配对。
 */
function pairRenames(
  added: string[],
  deleted: string[],
  dbHashByPath: Map<string, string>,
  curHashByPath: Map<string, string>,
): RenamedFile[] {
  // 统计各哈希在 added / deleted 侧的路径。
  const addedByHash = new Map<string, string[]>();
  for (const p of added) {
    const h = curHashByPath.get(p);
    if (h === undefined) continue;
    const arr = addedByHash.get(h);
    if (arr) arr.push(p);
    else addedByHash.set(h, [p]);
  }
  const deletedByHash = new Map<string, string[]>();
  for (const p of deleted) {
    const h = dbHashByPath.get(p);
    if (h === undefined) continue;
    const arr = deletedByHash.get(h);
    if (arr) arr.push(p);
    else deletedByHash.set(h, [p]);
  }

  const renamed: RenamedFile[] = [];
  const removedAdded = new Set<string>();
  const removedDeleted = new Set<string>();

  for (const [hash, delPaths] of deletedByHash) {
    const addPaths = addedByHash.get(hash);
    // 两侧均唯一才配对，规避同哈希歧义。
    if (delPaths.length === 1 && addPaths && addPaths.length === 1) {
      const from = delPaths[0]!;
      const to = addPaths[0]!;
      renamed.push({ from, to });
      removedDeleted.add(from);
      removedAdded.add(to);
    }
  }

  // 就地移除已配对项。
  if (removedAdded.size > 0) {
    for (let i = added.length - 1; i >= 0; i--) {
      if (removedAdded.has(added[i]!)) added.splice(i, 1);
    }
  }
  if (removedDeleted.size > 0) {
    for (let i = deleted.length - 1; i >= 0; i--) {
      if (removedDeleted.has(deleted[i]!)) deleted.splice(i, 1);
    }
  }

  return renamed.sort((a, b) => a.to.localeCompare(b.to));
}