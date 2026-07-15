/**
 * multimodal-linker.test.ts — 资源切片 ↔ 文件关联建边（M7）
 *
 * 用确定性向量在 file_vectors 上构造可控的余弦相似度：
 * 对单位向量，vec0 的 L2 距离 d 满足 similarity = 1 - d²/2 = cos，
 * 因此可直接用 cosine 控制落入 strong / weak / 不建边三档。
 *
 * 不依赖真实 Embedding 服务，仅消费 store 与 resources 封装。
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  openMemoryDatabase,
  closeDatabase,
  type DB,
} from "../src/graph/index.js";
import { upsertFiles } from "../src/graph/files.js";
import {
  insertResources,
  listResourceEdgesByResource,
  countResourceEdges,
} from "../src/graph/resources.js";
import { upsertVectors } from "../src/vector/store.js";
import { linkResources, type LinkableResource } from "../src/multimodal/linker.js";
import type { ConfidenceThresholds } from "../src/multimodal/confidence.js";

const DIM = 1024;

const THRESHOLDS: ConfidenceThresholds = {
  strongLinkThreshold: 0.85,
  weakLinkThreshold: 0.7,
};

/** 第 axis 维为 1、其余为 0 的单位向量（与自身 cos=1，与其他轴 cos=0） */
function unitVector(axis: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[axis % DIM] = 1;
  return v;
}

/**
 * 构造一个与 axis0 单位向量夹角余弦为 cos 的单位向量：
 * [cos, sqrt(1-cos²), 0, 0, ...]，模长为 1，故与 unitVector(0) 的 cos 精确可控。
 */
function vectorWithCosine(cos: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[0] = cos;
  v[1] = Math.sqrt(Math.max(0, 1 - cos * cos));
  return v;
}

let db: DB | undefined;
afterEach(() => {
  if (db) {
    closeDatabase(db);
    db = undefined;
  }
});

describe("linkResources", () => {
  it("按余弦相似度分级建边：strong / weak / 不建边", () => {
    db = openMemoryDatabase();

    // 三个文件：f1 与 query 同向(cos=1,strong)、f2 cos≈0.8(weak)、f3 正交(cos=0,不建边)
    const fileIds = upsertFiles(db, [
      { filePath: "a.ts", hash: "h1" },
      { filePath: "b.ts", hash: "h2" },
      { filePath: "c.ts", hash: "h3" },
    ]);
    const f1 = fileIds.get("a.ts")!;
    const f2 = fileIds.get("b.ts")!;
    const f3 = fileIds.get("c.ts")!;

    upsertVectors(db, "file_vectors", [
      { id: f1, vector: unitVector(0) },
      { id: f2, vector: vectorWithCosine(0.8) },
      { id: f3, vector: unitVector(500) },
    ]);

    // 一个资源切片，其向量对齐 axis0
    const [resId] = insertResources(db, [
      { type: "prd", name: "R1", sourcePath: "prd.md" },
    ]);
    const resources: LinkableResource[] = [
      { resourceId: resId!, vector: unitVector(0) },
    ];

    const result = linkResources(db, resources, {
      kind: "describes",
      topK: 10,
      thresholds: THRESHOLDS,
    });

    // f1(strong) + f2(weak) 建边，f3 不建边
    expect(result.edges).toBe(2);
    expect(result.strong).toBe(1);
    expect(result.weak).toBe(1);
    expect(countResourceEdges(db)).toBe(2);

    const edges = listResourceEdgesByResource(db, resId!);
    const byFile = new Map(edges.map((e) => [e.file_id, e]));
    expect(byFile.get(f1)!.link_type).toBe("strong");
    expect(byFile.get(f2)!.link_type).toBe("weak");
    expect(byFile.has(f3)).toBe(false);
  });

  it("无命中（全部低于 weak 阈值）时不建边", () => {
    db = openMemoryDatabase();
    const fileIds = upsertFiles(db, [{ filePath: "x.ts", hash: "hx" }]);
    const fx = fileIds.get("x.ts")!;
    upsertVectors(db, "file_vectors", [{ id: fx, vector: unitVector(500) }]);

    const [resId] = insertResources(db, [
      { type: "db", name: "T1", sourcePath: "s.sql" },
    ]);
    const result = linkResources(
      db,
      [{ resourceId: resId!, vector: unitVector(0) }],
      { kind: "reads", topK: 10, thresholds: THRESHOLDS },
    );

    expect(result.edges).toBe(0);
    expect(countResourceEdges(db)).toBe(0);
  });

  it("空资源列表返回全零", () => {
    db = openMemoryDatabase();
    const result = linkResources(db, [], {
      kind: "describes",
      topK: 10,
      thresholds: THRESHOLDS,
    });
    expect(result).toEqual({ edges: 0, strong: 0, weak: 0 });
  });
});