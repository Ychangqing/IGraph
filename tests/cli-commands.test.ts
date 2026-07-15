/**
 * cli-commands.test.ts — CLI 命令注册测试（M9-A）
 *
 * 验证 buildProgram() 装配了预期的子命令，重点覆盖新增的 status / rebuild，
 * 以及它们声明的关键选项。仅做“注册面”校验，不触发 action（避免依赖工作目录
 * 与真实数据库），保持测试稳定、快速。
 */
import { describe, it, expect } from "vitest";
import { buildProgram } from "../src/cli/index.js";

function commandNames(): string[] {
  return buildProgram().commands.map((c) => c.name());
}

describe("cli command registration", () => {
  it("注册了全部核心子命令（含新增 status / rebuild）", () => {
    const names = commandNames();
    for (const name of [
      "init",
      "build",
      "rebuild",
      "status",
      "query",
      "eval",
      "serve",
      "mount",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("rebuild 声明了 --full / --dry-run / --no-llm 选项", () => {
    const rebuild = buildProgram().commands.find((c) => c.name() === "rebuild");
    expect(rebuild).toBeDefined();
    const flags = rebuild!.options.map((o) => o.long);
    expect(flags).toContain("--full");
    expect(flags).toContain("--dry-run");
    // commander 对 --no-llm 归一化为 --no-llm（long 为 --no-llm）
    expect(flags).toContain("--no-llm");
  });

  it("status 命令具备描述文本", () => {
    const status = buildProgram().commands.find((c) => c.name() === "status");
    expect(status).toBeDefined();
    expect(status!.description().length).toBeGreaterThan(0);
  });

  it("所有子命令均具备非空描述文本", () => {
    const cmds = buildProgram().commands;
    expect(cmds.length).toBe(11);
    for (const cmd of cmds) {
      expect(cmd.description().length).toBeGreaterThan(0);
    }
  });

  it("build 声明了 --incremental / --dry-run / --no-llm 选项", () => {
    const build = buildProgram().commands.find((c) => c.name() === "build");
    expect(build).toBeDefined();
    const flags = build!.options.map((o) => o.long);
    expect(flags).toContain("--incremental");
    expect(flags).toContain("--dry-run");
    expect(flags).toContain("--no-llm");
  });

  it("init 声明了 -f / --force 选项", () => {
    const init = buildProgram().commands.find((c) => c.name() === "init");
    expect(init).toBeDefined();
    const flags = init!.options.map((o) => o.long);
    expect(flags).toContain("--force");
  });

  it("query 声明了 --top-k / --json 选项", () => {
    const query = buildProgram().commands.find((c) => c.name() === "query");
    expect(query).toBeDefined();
    const flags = query!.options.map((o) => o.long);
    expect(flags).toContain("--top-k");
    expect(flags).toContain("--json");
  });

  it("eval 声明了 --test-set / --top-k 选项", () => {
    const ev = buildProgram().commands.find((c) => c.name() === "eval");
    expect(ev).toBeDefined();
    const flags = ev!.options.map((o) => o.long);
    expect(flags).toContain("--test-set");
    expect(flags).toContain("--top-k");
  });

  it("rebuild --full 描述包含默认行为", () => {
    const rebuild = buildProgram().commands.find((c) => c.name() === "rebuild");
    const fullOpt = rebuild!.options.find((o) => o.long === "--full");
    expect(fullOpt).toBeDefined();
    expect(fullOpt!.description).toContain("默认行为");
  });

  it("mount 包含 prd 和 db 两个子命令", () => {
    const mount = buildProgram().commands.find((c) => c.name() === "mount");
    expect(mount).toBeDefined();
    const subNames = mount!.commands.map((c) => c.name());
    expect(subNames).toContain("prd");
    expect(subNames).toContain("db");
  });
});