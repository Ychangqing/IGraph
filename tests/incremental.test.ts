/**
 * incremental.test.ts — 增量更新（M8）集成测试
 *
 * 覆盖验收要求的五个场景，全程不依赖真实 LLM / Embedding 服务：
 *   - 新增文件：detectChanges 归为 added，classify 归入 rebuildPaths，
 *     rebuildFiles 落库新节点。
 *   - 修改文件：detectChanges 归为 modified，rebuildFiles 覆盖旧节点、
 *     置摘要/向量状态为 pending。
 *   - 删除文件：detectChanges 归为 deleted，cascadeDeleteFile 级联清除
 *     files/nodes/edges 及向量。
 *   - 重命名文件：内容不变 → detectChanges 归为 renamed，renameFile 仅改路径，
 *     节点随 file_id 保留。
 *   - 多模态边刷新：refreshMultimodalEdges 复用已存资源向量在 file_vectors 上
 *     重连，用确定性向量控制 strong/weak 落档。
 *
 * 前四个场景用真实临时目录 + parseRepository 首建，再改动文件后跑增量原语；
 * 多模态场景用内存库 + 确定性向量直接验证。
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openMemoryDatabase,
  closeDatabase,
  ingestParseResult,
  countFiles,
  countNodes,
  getFileByPath,
  getNodesByFile,
  upsertFiles,
  type DB,
} from "../src/graph/index.js";
import { insertResources } from "../src/graph/resources.js";
import { upsertVectors, countVectors } from "../src/vector/store.js";
import { parseRepository } from "../src/parser/index.js";
import { detectChanges } from "../src/incremental/diff-detector.js";
import { classifyChanges } from "../src/incremental/change-classifier.js";
import {
  cascadeDeleteFile,
  renameFile,
  rebuildFiles,
} from "../src/incremental/cascade.js";
import { refreshMultimodalEdges } from "../src/multimodal/index.js";
import type { ResolvedConfig } from "../src/config/index.js";

const DIM = 1024;
const INCLUDE = ["**/*.ts", "**/*.tsx"];
const EXCLUDE = ["**/node_modules/**", "**/.igraph/**"];

let db: DB | undefined;
const tmpDirs: string[] = [];

afterEach(() => {
  if (db) {
    closeDatabase(db);
    db = undefined;
  }
  for (const d of tmpDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

/** 建临时工作区并写入初始文件 */
function makeWorkspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "igraph-inc-"));
  tmpDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return root;
}

/** 首建：全量解析并落库到内存库 */
async function firstBuild(root: string): Promise<void> {
  const full = await parseRepository({ root, include: INCLUDE, exclude: EXCLUDE });
  ingestParseResult(db!, full);
}

describe("增量：新增文件", () => {
  it("detectChanges 归为 added 并 rebuild 落库新节点", async () => {
    db = openMemoryDatabase();
    const root = makeWorkspace({
      "src/a.ts": "export function foo() { return 1; }\n",
    });
    await firstBuild(root);
    const before = countFiles(db);

    // 新增文件
    writeFileSync(join(root, "src/b.ts"), "export function bar() { return 2; }\n");

    const changes = await detectChanges(db, { root, include: INCLUDE, exclude: EXCLUDE });
    expect(changes.added).toContain("src/b.ts");
    expect(changes.modified).toHaveLength(0);
    expect(changes.deleted).toHaveLength(0);

    const plan = classifyChanges(changes);
    expect(plan.rebuildPaths).toContain("src/b.ts");

    const full = await parseRepository({ root, include: INCLUDE, exclude: EXCLUDE });
    rebuildFiles(db, full, plan.rebuildPaths);

    expect(countFiles(db)).toBe(before + 1);
    const bFile = getFileByPath(db, "src/b.ts");
    expect(bFile).toBeDefined();
    expect(getNodesByFile(db, bFile!.id).length).toBeGreaterThan(0);
  });
});

describe("增量：修改文件", () => {
  it("detectChanges 归为 modified 且 rebuild 后状态重置 pending", async () => {
    db = openMemoryDatabase();
    const root = makeWorkspace({
      "src/a.ts": "export function foo() { return 1; }\n",
    });
    await firstBuild(root);
    const fileBefore = getFileByPath(db, "src/a.ts");
    expect(fileBefore).toBeDefined();

    // 修改内容
    writeFileSync(
      join(root, "src/a.ts"),
      "export function foo() { return 1; }\nexport function baz() { return 3; }\n",
    );

    const changes = await detectChanges(db, { root, include: INCLUDE, exclude: EXCLUDE });
    expect(changes.modified).toContain("src/a.ts");
    expect(changes.added).toHaveLength(0);

    const plan = classifyChanges(changes);
    const full = await parseRepository({ root, include: INCLUDE, exclude: EXCLUDE });
    rebuildFiles(db, full, plan.rebuildPaths);

    const fileAfter = getFileByPath(db, "src/a.ts");
    expect(fileAfter).toBeDefined();
    // hash 已更新
    expect(fileAfter!.hash).not.toBe(fileBefore!.hash);
    // 状态重置为 pending，待断点续传处理
    expect(fileAfter!.summary_status).toBe("pending");
    expect(fileAfter!.embedding_status).toBe("pending");
    // 新增了 baz 节点
    expect(getNodesByFile(db, fileAfter!.id).length).toBeGreaterThan(1);
  });
});

describe("增量：删除文件", () => {
  it("detectChanges 归为 deleted 且 cascadeDeleteFile 级联清除", async () => {
    db = openMemoryDatabase();
    const root = makeWorkspace({
      "src/a.ts": "export function foo() { return 1; }\n",
      "src/b.ts": "export function bar() { return 2; }\n",
    });
    await firstBuild(root);
    expect(countFiles(db)).toBe(2);
    const bFile = getFileByPath(db, "src/b.ts");
    const bNodes = getNodesByFile(db, bFile!.id).length;
    expect(bNodes).toBeGreaterThan(0);

    // 删除 b.ts
    rmSync(join(root, "src/b.ts"));

    const changes = await detectChanges(db, { root, include: INCLUDE, exclude: EXCLUDE });
    expect(changes.deleted).toContain("src/b.ts");

    const plan = classifyChanges(changes);
    expect(plan.deletePaths).toContain("src/b.ts");

    const nodesBefore = countNodes(db);
    const res = cascadeDeleteFile(db, "src/b.ts");
    expect(res.deleted).toBe(true);
    expect(countFiles(db)).toBe(1);
    expect(getFileByPath(db, "src/b.ts")).toBeUndefined();
    // 级联删除了 b 的节点
    expect(countNodes(db)).toBe(nodesBefore - bNodes);
  });
});

describe("增量：重命名文件", () => {
  it("内容不变 → detectChanges 归为 renamed 且 renameFile 仅改路径", async () => {
    db = openMemoryDatabase();
    const content = "export function onlyOne() { return 42; }\n";
    const root = makeWorkspace({ "src/old.ts": content });
    await firstBuild(root);
    const oldFile = getFileByPath(db, "src/old.ts");
    expect(oldFile).toBeDefined();
    const oldId = oldFile!.id;
    const oldNodeCount = getNodesByFile(db, oldId).length;

    // 重命名（内容完全不变）
    renameSync(join(root, "src/old.ts"), join(root, "src/new.ts"));

    const changes = await detectChanges(db, { root, include: INCLUDE, exclude: EXCLUDE });
    expect(changes.renamed).toEqual([{ from: "src/old.ts", to: "src/new.ts" }]);
    expect(changes.added).toHaveLength(0);
    expect(changes.deleted).toHaveLength(0);

    const plan = classifyChanges(changes);
    expect(plan.renames).toHaveLength(1);
    expect(renameFile(db, "src/old.ts", "src/new.ts")).toBe(true);

    // file_id 不变，节点随之保留
    const newFile = getFileByPath(db, "src/new.ts");
    expect(newFile).toBeDefined();
    expect(newFile!.id).toBe(oldId);
    expect(getNodesByFile(db, oldId).length).toBe(oldNodeCount);
    expect(getFileByPath(db, "src/old.ts")).toBeUndefined();
  });
});

/** 第 axis 维为 1、其余 0 的单位向量 */
function unitVector(axis: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[axis % DIM] = 1;
  return v;
}

/** 构造多模态刷新所需的最小 config */
function fakeConfig(): ResolvedConfig {
  return {
    multimodal: { strongLinkThreshold: 0.85, weakLinkThreshold: 0.7 },
    retrieval: { fileTopK: 5 },
    credentials: { apiKey: "test-key" },
  } as unknown as ResolvedConfig;
}

describe("增量：多模态边刷新", () => {
  it("refreshMultimodalEdges 复用已存资源向量重连文件", () => {
    db = openMemoryDatabase();
    // 落库两个文件 + 其 file_vectors（同轴 → 与资源向量 cos=1，落 strong）
    upsertFiles(db, [
      { filePath: "src/a.ts", hash: "ha" },
      { filePath: "src/b.ts", hash: "hb" },
    ]);
    const aFile = getFileByPath(db, "src/a.ts")!;
    const bFile = getFileByPath(db, "src/b.ts")!;
    upsertVectors(db, "file_vectors", [
      { id: aFile.id, vector: unitVector(0) },
      { id: bFile.id, vector: unitVector(1) },
    ]);

    // 落库一个 PRD 资源切片 + 其 resource_vector（对齐 a 文件轴）
    const [resId] = insertResources(db, [
      { type: "prd", name: "需求1", content: "c", summary: "s" },
    ]);
    upsertVectors(db, "resource_vectors", [{ id: resId!, vector: unitVector(0) }]);

    expect(countVectors(db, "resource_vectors")).toBe(1);

    const result = refreshMultimodalEdges(db, fakeConfig(), [aFile.id, bFile.id]);
    expect(result.refreshed).toBe(1);
    expect(result.skipped).toBe(0);
    // 至少与轴对齐的 a 文件建立了边
    expect(result.edges).toBeGreaterThan(0);
    expect(result.strong).toBeGreaterThan(0);
  });
});