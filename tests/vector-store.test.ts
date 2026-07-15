/**
 * vector-store.test.ts — 向量存储层（sqlite-vec）
 *
 * 覆盖：
 * - serializeVector / distanceToSimilarity 换算；
 * - upsert 幂等（重复 id 不新增行）；
 * - KNN searchVectors 按距离升序、similarity 换算正确；
 * - searchVectorsWithin 仅在给定子集内检索。
 *
 * 使用确定性单位向量（避免依赖真实 Embedding 服务）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { openMemoryDatabase, closeDatabase, type DB } from "../src/graph/index.js";
import {
  serializeVector,
  distanceToSimilarity,
  upsertVector,
  upsertVectors,
  countVectors,
  deleteVector,
  searchVectors,
  searchVectorsWithin,
} from "../src/vector/store.js";

const DIM = 1024;

/** 构造一个第 axis 维为 1、其余为 0 的单位向量 */
function unitVector(axis: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[axis % DIM] = 1;
  return v;
}

let db: DB | undefined;
afterEach(() => {
  if (db) {
    closeDatabase(db);
    db = undefined;
  }
});

describe("serializeVector / distanceToSimilarity", () => {
  it("序列化为 Float32 BLOB，字节长度 = 维度 * 4", () => {
    const buf = serializeVector(unitVector(0));
    expect(buf.byteLength).toBe(DIM * 4);
  });

  it("距离 0 → 相似度 1；正交单位向量距离 √2 → 相似度 0", () => {
    expect(distanceToSimilarity(0)).toBeCloseTo(1, 10);
    expect(distanceToSimilarity(Math.SQRT2)).toBeCloseTo(0, 10);
  });
});

describe("upsert / count / delete", () => {
  it("upsert 幂等：同 id 覆盖而非新增", () => {
    db = openMemoryDatabase();
    upsertVector(db, "node_vectors", 1, unitVector(0));
    upsertVector(db, "node_vectors", 1, unitVector(1));
    expect(countVectors(db, "node_vectors")).toBe(1);
    deleteVector(db, "node_vectors", 1);
    expect(countVectors(db, "node_vectors")).toBe(0);
  });
});

describe("searchVectors - KNN", () => {
  it("返回按距离升序，query 与自身距离最近", () => {
    db = openMemoryDatabase();
    upsertVectors(db, "node_vectors", [
      { id: 1, vector: unitVector(0) },
      { id: 2, vector: unitVector(1) },
      { id: 3, vector: unitVector(2) },
    ]);
    const hits = searchVectors(db, "node_vectors", unitVector(0), 3);
    expect(hits[0]!.id).toBe(1);
    expect(hits[0]!.distance).toBeCloseTo(0, 5);
    expect(hits[0]!.similarity).toBeCloseTo(1, 5);
    // 后续为正交向量，相似度约 0
    expect(hits[1]!.similarity).toBeCloseTo(0, 5);
  });

  it("topK<=0 返回空", () => {
    db = openMemoryDatabase();
    upsertVector(db, "node_vectors", 1, unitVector(0));
    expect(searchVectors(db, "node_vectors", unitVector(0), 0)).toEqual([]);
  });
});

describe("searchVectorsWithin - 子集检索", () => {
  it("仅在给定 id 子集内检索并按距离排序", () => {
    db = openMemoryDatabase();
    upsertVectors(db, "node_vectors", [
      { id: 1, vector: unitVector(0) },
      { id: 2, vector: unitVector(1) },
      { id: 3, vector: unitVector(2) },
    ]);
    // 查询接近 axis1，但子集只含 {2,3}
    const hits = searchVectorsWithin(db, "node_vectors", unitVector(1), [2, 3], 5);
    expect(hits.map((h) => h.id).sort()).toEqual([2, 3]);
    expect(hits[0]!.id).toBe(2); // 与 axis1 最近
  });

  it("空子集返回空", () => {
    db = openMemoryDatabase();
    expect(searchVectorsWithin(db, "node_vectors", unitVector(0), [], 5)).toEqual(
      [],
    );
  });
});