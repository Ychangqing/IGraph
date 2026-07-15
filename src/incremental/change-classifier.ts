/**
 * incremental/change-classifier.ts — 变更集分类为可执行动作计划
 *
 * diff-detector 产出的 ChangeSet 是「事实描述」（哪些文件增/改/删/重命名）；
 * 本模块把它翻译为「执行计划」ChangePlan，供 incremental/index.ts 编排：
 *
 *   - deletePaths：需级联删除的文件路径（cascadeDeleteFile）。
 *   - renames：需改路径的重命名对（renameFile），内容未变、无需重解析。
 *   - rebuildPaths：需重解析 / 重摘要 / 重向量化的文件路径集合，
 *       = added ∪ modified（新增与内容变更都要走完整重建）。
 *
 * 说明：重命名文件内容不变，其节点/向量随路径迁移即可，不进 rebuildPaths；
 * 但重命名会改变文件在多模态匹配中的语义定位吗？不会——匹配基于向量，
 * 向量未变。故重命名不触发多模态重连，仅 added/modified/deleted 影响文件向量集。
 */
import type { ChangeSet, RenamedFile } from "./diff-detector.js";

/** 变更执行计划 */
export interface ChangePlan {
  /** 需级联删除的文件路径 */
  deletePaths: string[];
  /** 需改路径的重命名对 */
  renames: RenamedFile[];
  /** 需重建（重解析/摘要/向量化）的文件路径：added ∪ modified */
  rebuildPaths: string[];
  /** 是否存在任何需要执行的动作 */
  hasWork: boolean;
}

/**
 * 将变更集分类为执行计划。
 *
 * rebuildPaths 合并 added 与 modified 并去重（理论上二者路径不相交，
 * 去重仅作防御）。deletePaths 直接取 deleted。renames 原样透传。
 */
export function classifyChanges(changes: ChangeSet): ChangePlan {
  const rebuildSet = new Set<string>();
  for (const p of changes.added) {
    rebuildSet.add(p);
  }
  for (const p of changes.modified) {
    rebuildSet.add(p);
  }

  const deletePaths = [...changes.deleted];
  const renames = [...changes.renamed];
  const rebuildPaths = [...rebuildSet];

  const hasWork =
    deletePaths.length > 0 || renames.length > 0 || rebuildPaths.length > 0;

  return { deletePaths, renames, rebuildPaths, hasWork };
}