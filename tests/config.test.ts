/**
 * config.test.ts — config 模块冒烟测试
 *
 * 覆盖 M0 关键行为：
 * - init 生成合法配置文件
 * - 默认值合并
 * - 凭据从环境变量注入 + 缺失报错
 * - 安全护栏：拒绝含密钥字段的配置文件
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/global.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/global.js")>();
  return {
    ...actual,
    readGlobalConfig: vi.fn(() => ({})),
  };
});
import {
  ConfigValidationError,
  DEFAULT_CONFIG,
  ENV_API_KEY,
  getConfigPath,
  loadConfig,
  validateConfig,
} from "../src/config/index.js";
import { runInit } from "../src/cli/init.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "igraph-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env[ENV_API_KEY];
});

describe("runInit", () => {
  it("生成合法且可校验的配置文件", () => {
    const path = runInit(tmp);
    expect(path).toBe(getConfigPath(tmp));
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const cfg = validateConfig(raw);
    expect(cfg.retrieval.fusion).toBe("rrf");
    expect(cfg.retrieval.rrfK).toBe(60);
  });

  it("默认不覆盖已存在文件", () => {
    runInit(tmp);
    const before = readFileSync(getConfigPath(tmp), "utf-8");
    writeFileSync(getConfigPath(tmp), before.replace("bge-m3", "changed"));
    runInit(tmp); // 无 force
    expect(readFileSync(getConfigPath(tmp), "utf-8")).toContain("changed");
  });
});

describe("loadConfig", () => {
  it("合并默认值并从环境变量注入凭据", () => {
    runInit(tmp);
    process.env[ENV_API_KEY] = "sk-test";
    const resolved = loadConfig(tmp, true);
    expect(resolved.credentials.apiKey).toBe("sk-test");
    expect(resolved.embedding.model).toBe(DEFAULT_CONFIG.embedding.model);
  });

  it("缺失 API Key 时抛错", () => {
    runInit(tmp);
    expect(() => loadConfig(tmp, true)).toThrow(ConfigValidationError);
  });

  it("不需要凭据时允许缺失 API Key", () => {
    runInit(tmp);
    const resolved = loadConfig(tmp, false);
    expect(resolved.credentials.apiKey).toBe("");
  });
});

describe("validateConfig 安全护栏", () => {
  it("拒绝含密钥字段的配置文件", () => {
    mkdirSync(join(tmp, ".igraph"), { recursive: true });
    const bad = { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm, apiKey: "sk-leak" }};
    expect(() => validateConfig(bad)).toThrow(/凭据字段/);
  });

  it("拒绝非对象输入", () => {
    expect(() => validateConfig(null)).toThrow(ConfigValidationError);
  });
});