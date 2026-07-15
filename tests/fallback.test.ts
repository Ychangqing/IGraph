/**
 * fallback.test.ts — 启发式降级摘要（无 LLM / 无密钥）
 *
 * 覆盖：
 * - 文件摘要优先使用导出符号名，无导出时回退全部符号名，空集给占位；
 * - 节点摘要拼接函数名 + 签名；
 * - heuristicSummaries 一次性产出 file + node 摘要 Map。
 */
import { describe, it, expect } from "vitest";
import {
  HEURISTIC_MODEL,
  heuristicFileSummary,
  heuristicNodeSummary,
  heuristicSummaries,
  type HeuristicSymbol,
} from "../src/semantic/fallback.js";

const sym = (
  name: string,
  signature: string,
  isExported: boolean,
): HeuristicSymbol => ({ name, signature, isExported });

describe("heuristicFileSummary", () => {
  it("优先使用导出符号名", () => {
    const out = heuristicFileSummary("src/foo/bar.ts", [
      sym("pub", "()", true),
      sym("priv", "()", false),
    ]);
    expect(out).toBe("bar.ts: pub");
  });

  it("无导出符号时回退到全部符号名", () => {
    const out = heuristicFileSummary("src/foo/bar.ts", [
      sym("a", "()", false),
      sym("b", "()", false),
    ]);
    expect(out).toBe("bar.ts: a, b");
  });

  it("空符号集给出占位说明", () => {
    expect(heuristicFileSummary("src/empty.ts", [])).toBe("empty.ts: 无导出符号");
  });
});

describe("heuristicNodeSummary", () => {
  it("拼接名字与签名", () => {
    expect(heuristicNodeSummary(sym("foo", "(a: number): void", true))).toBe(
      "foo(a: number): void",
    );
  });

  it("无签名时仅返回名字", () => {
    expect(heuristicNodeSummary(sym("foo", "", true))).toBe("foo");
  });
});

describe("heuristicSummaries", () => {
  it("一次性产出 file + node 摘要", () => {
    const result = heuristicSummaries("src/x.ts", [
      sym("run", "(): void", true),
      sym("helper", "()", false),
    ]);
    expect(result.fileSummary).toBe("x.ts: run");
    expect(result.nodeSummaries.get("run")).toBe("run(): void");
    expect(result.nodeSummaries.get("helper")).toBe("helper()");
    expect(result.nodeSummaries.size).toBe(2);
  });

  it("HEURISTIC_MODEL 常量为 'heuristic'", () => {
    expect(HEURISTIC_MODEL).toBe("heuristic");
  });
});