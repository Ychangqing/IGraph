/**
 * parser/file-scanner.ts — 文件扫描
 *
 * 职责：
 * - 依据 config.parser.include / exclude glob 收集候选文件。
 * - 叠加仓库根 `.gitignore` 规则过滤（使用 ignore 库）。
 * - 依据 languages/registry 支持的扩展名筛掉无法解析的文件。
 * - 读取源码，产出 ScannedFile[]（含相对路径、绝对路径、语言、源码）。
 *
 * 注：include/exclude 已能覆盖 node_modules、dist、测试文件等；.gitignore 作为
 * 额外一层过滤，二者取交集（被任一排除即剔除）。
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { glob } from "glob";
import ignoreFactory from "ignore";
import type { Ignore } from "ignore";
import type { ScannedFile } from "../types/index.js";
import { detectLanguage } from "./languages/registry.js";

export interface ScanOptions {
  /** 仓库根绝对路径 */
  root: string;
  /** 包含 glob（相对 root） */
  include: string[];
  /** 排除 glob（相对 root） */
  exclude: string[];
  /** 可选：只读取这些相对路径的文件源码（增量优化，跳过其余文件的 I/O） */
  onlyPaths?: Set<string>;
}

/** 读取仓库根 .gitignore，构造 ignore 匹配器（不存在则返回空匹配器） */
function buildGitignore(root: string): Ignore {
  const ig: Ignore = (ignoreFactory as unknown as (o?: unknown) => Ignore)();
  const gitignorePath = join(root, ".gitignore");
  if (existsSync(gitignorePath)) {
    ig.add(readFileSync(gitignorePath, "utf-8"));
  }
  // 始终忽略 .git 目录本身
  ig.add(".git/");
  return ig;
}

/**
 * 扫描并读取满足条件的源码文件。
 * @returns 去重、排序后的 ScannedFile 列表
 */
export async function scanFiles(options: ScanOptions): Promise<ScannedFile[]> {
  const { root, include, exclude, onlyPaths } = options;

  // glob 收集候选（相对路径），交由 glob 的 ignore 处理 exclude
  const matches = await glob(include, {
    cwd: root,
    nodir: true,
    dot: false,
    ignore: exclude,
    posix: true,
  });

  const ig = buildGitignore(root);
  const seen = new Set<string>();
  const results: ScannedFile[] = [];

  for (const rel of matches) {
    // 统一为 posix 相对路径供 ignore 匹配
    const relPosix = rel.split(sep).join("/");
    if (seen.has(relPosix)) continue;

    // .gitignore 过滤
    if (ig.ignores(relPosix)) continue;

    // 语言识别（不支持的扩展名跳过）
    const language = detectLanguage(relPosix);
    if (language === undefined) continue;

    // 增量优化：只读取指定文件的源码
    if (onlyPaths !== undefined && !onlyPaths.has(relPosix)) continue;

    const absPath = join(root, rel);
    let sourceCode: string;
    try {
      sourceCode = readFileSync(absPath, "utf-8");
    } catch {
      continue; // 读取失败（软链断裂等）跳过
    }

    // 跳过含 NUL 字节的二进制文件（被错误匹配为 .ts/.js 扩展名）
    if (sourceCode.includes("\0")) continue;

    seen.add(relPosix);
    results.push({
      filePath: relPosix,
      absPath,
      language,
      sourceCode,
    });
  }

  // 稳定排序，保证输出可复现
  results.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return results;
}

/**
 * 将绝对路径转为相对仓库根的 posix 路径（供路径解析复用）。
 */
export function toRepoRelative(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join("/");
}