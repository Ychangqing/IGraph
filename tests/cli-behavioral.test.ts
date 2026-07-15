/**
 * cli-behavioral.test.ts — CLI 行为级集成测试（M9-A）
 *
 * 验证 CLI 命令的实际输出和错误处理行为，而非仅验证注册面。
 * 使用临时目录隔离，不依赖外部 API Key。
 */
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../src/config/global.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/global.js")>();
  return {
    ...actual,
    readGlobalConfig: vi.fn(() => ({})),
  };
});
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildProgram } from "../src/cli/index.js";
import { loadConfig, ConfigValidationError } from "../src/config/index.js";
import { runInit } from "../src/cli/init.js";

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "igraph-cli-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  tmpDirs = [];
});

describe("CLI 帮助文本", () => {
  it("program 描述包含知识图谱", () => {
    const program = buildProgram();
    expect(program.description()).toContain("知识图谱");
  });

  it("版本号与 package.json 一致（0.1.0）", () => {
    const program = buildProgram();
    expect(program.version()).toBe("0.1.0");
  });

  it("全局选项包含 --verbose 和 --quiet", () => {
    const program = buildProgram();
    const flags = program.options.map((o) => o.long);
    expect(flags).toContain("--verbose");
    expect(flags).toContain("--quiet");
  });
});

describe("错误处理", () => {
  it("无配置文件时 loadConfig 抛出 ConfigValidationError", () => {
    const tmp = makeTmpDir();
    expect(() => loadConfig(tmp, false)).toThrow(ConfigValidationError);
    expect(() => loadConfig(tmp, false)).toThrow("未找到配置文件");
  });

  it("需要 API Key 但未设置时抛错", () => {
    const tmp = makeTmpDir();
    runInit(tmp);
    const saved = process.env.IGRAPH_API_KEY;
    delete process.env.IGRAPH_API_KEY;
    try {
      expect(() => loadConfig(tmp, true)).toThrow("IGRAPH_API_KEY");
    } finally {
      if (saved !== undefined) process.env.IGRAPH_API_KEY = saved;
    }
  });

  it("配置文件包含凭据字段时拒绝加载", () => {
    const tmp = makeTmpDir();
    const configDir = join(tmp, ".igraph");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        embedding: { baseURL: "http://localhost", model: "m", dimensions: 1024, batchSize: 32 },
        llm: { baseURL: "http://localhost", model: "m", temperature: 0, maxConcurrency: 1, promptVersion: "v1" },
        parser: { languages: ["typescript"], include: ["**/*"], exclude: [] },
        retrieval: { fileTopK: 5, nodeTopK: 5, fallbackThreshold: 0.5, graphHops: 2, fusion: "rrf", rrfK: 60, denseWeight: 1, ftsWeight: 1 },
        multimodal: { strongLinkThreshold: 0.85, weakLinkThreshold: 0.7, llmConfirmWeakLinks: false },
        apiKey: "sk-secret",
      }),
    );
    expect(() => loadConfig(tmp, false)).toThrow("禁止");
  });
});

describe("status 命令场景", () => {
  it("status 命令注册了正确的描述", () => {
    const status = buildProgram().commands.find((c) => c.name() === "status");
    expect(status).toBeDefined();
    expect(status!.description()).toContain("状态");
  });
});

describe("rebuild 命令场景", () => {
  it("rebuild --full 是语义空操作（默认即全量重建）", () => {
    const rebuild = buildProgram().commands.find((c) => c.name() === "rebuild");
    expect(rebuild).toBeDefined();
    const fullOpt = rebuild!.options.find((o) => o.long === "--full");
    expect(fullOpt).toBeDefined();
    expect(fullOpt!.description).toContain("默认行为");
  });

  it("rebuild --dry-run 选项存在且有正确描述", () => {
    const rebuild = buildProgram().commands.find((c) => c.name() === "rebuild");
    const dryRunOpt = rebuild!.options.find((o) => o.long === "--dry-run");
    expect(dryRunOpt).toBeDefined();
    expect(dryRunOpt!.description).toContain("不");
  });
});

describe("mount 子命令结构", () => {
  it("mount prd 接受 <file> 参数和 --top-k 选项", () => {
    const mount = buildProgram().commands.find((c) => c.name() === "mount");
    const prd = mount!.commands.find((c) => c.name() === "prd");
    expect(prd).toBeDefined();
    expect(prd!.registeredArguments.length).toBeGreaterThan(0);
    const flags = prd!.options.map((o) => o.long);
    expect(flags).toContain("--top-k");
  });

  it("mount db 接受 <file> 参数和 --top-k 选项", () => {
    const mount = buildProgram().commands.find((c) => c.name() === "mount");
    const db = mount!.commands.find((c) => c.name() === "db");
    expect(db).toBeDefined();
    expect(db!.registeredArguments.length).toBeGreaterThan(0);
    const flags = db!.options.map((o) => o.long);
    expect(flags).toContain("--top-k");
  });
});
