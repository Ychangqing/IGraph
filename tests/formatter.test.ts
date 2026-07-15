/**
 * formatter.test.ts — 检索结果结构化输出（含多模态资源边带出）
 *
 * 验证 formatResult 能沿 hits/neighbors 涉及的文件展开 resource_edges，
 * 用真实内存图谱构造：file → node → resource_edge → resource，
 * 断言 FormattedResult.resources 带出关联的 PRD/DB 资源，且 renderText 输出可读段落。
 */
import { describe, it, expect, afterEach } from "vitest";
import { openMemoryDatabase, closeDatabase, type DB } from "../src/graph/index.js";
import { upsertFiles } from "../src/graph/files.js";
import { insertNode } from "../src/graph/nodes.js";
import { insertResources, upsertResourceEdge } from "../src/graph/resources.js";
import { formatResult, renderText } from "../src/retrieval/formatter.js";
import type { SearchResponse } from "../src/retrieval/search.js";

let db: DB | undefined;
afterEach(() => {
  if (db) {
    closeDatabase(db);
    db = undefined;
  }
});

/** 构造仅含一个命中节点的最小 SearchResponse */
function responseForNode(nodeId: number): SearchResponse {
  return {
    results: [
      {
        nodeId,
        denseRank: 0,
        ftsRank: null,
        rrfScore: 0.5,
        matchChannel: "dense",
        denseSimilarity: 0.9,
      },
    ],
    diagnostics: {
      candidateFileIds: [],
      maxDenseSimilarity: 0.9,
      fallbackTriggered: false,
    },
  };
}

describe("formatResult resources", () => {
  it("命中节点所属文件挂有 resource_edge 时，带出关联资源", () => {
    db = openMemoryDatabase();

    const fileIds = upsertFiles(db, [{ filePath: "svc/auth.ts", hash: "h1" }]);
    const fileId = fileIds.get("svc/auth.ts")!;

    const nodeId = insertNode(db, {
      fileId,
      name: "login",
      kind: "function",
      startLine: 1,
      endLine: 10,
    });

    const [prdId] = insertResources(db, [
      { type: "prd", name: "登录需求点", sourcePath: "prd.md", summary: "用户登录流程" },
    ]);
    upsertResourceEdge(db, {
      resourceId: prdId!,
      fileId,
      kind: "describes",
      similarity: 0.9,
      confidence: 0.88,
      linkType: "strong",
    });

    const result = formatResult(db, "login", responseForNode(nodeId), []);

    expect(result.resources).toHaveLength(1);
    const r = result.resources[0]!;
    expect(r.resourceId).toBe(prdId);
    expect(r.type).toBe("prd");
    expect(r.name).toBe("登录需求点");
    expect(r.kind).toBe("describes");
    expect(r.confidence).toBeCloseTo(0.88);
    expect(r.linkType).toBe("strong");
    expect(r.relatedFilePath).toBe("svc/auth.ts");

    const text = renderText(result);
    expect(text).toContain("关联资源");
    expect(text).toContain("登录需求点");
  });

  it("无 resource_edge 时 resources 为空且文本不含关联资源段", () => {
    db = openMemoryDatabase();

    const fileIds = upsertFiles(db, [{ filePath: "svc/plain.ts", hash: "h2" }]);
    const fileId = fileIds.get("svc/plain.ts")!;
    const nodeId = insertNode(db, {
      fileId,
      name: "helper",
      kind: "function",
    });

    const result = formatResult(db, "helper", responseForNode(nodeId), []);

    expect(result.resources).toHaveLength(0);
    expect(renderText(result)).not.toContain("关联资源");
  });
});