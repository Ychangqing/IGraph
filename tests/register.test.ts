/**
 * register.test.ts — igraph register / unregister 命令测试
 *
 * 在临时目录中验证 MCP 配置写入、幂等性、注销、空文件清理、JSON 损坏备份等。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildProgram } from "../src/cli/index.js";
import { runRegister, runUnregister, readJsonSafe } from "../src/cli/register.js";

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "igraph-reg-"));
}

describe("register / unregister 命令注册", () => {
  it("buildProgram 包含 register 和 unregister 子命令", () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toContain("register");
    expect(names).toContain("unregister");
  });

  it("register 声明了 --target 和 --global 选项", () => {
    const reg = buildProgram().commands.find((c) => c.name() === "register");
    expect(reg).toBeDefined();
    const flags = reg!.options.map((o) => o.long);
    expect(flags).toContain("--target");
    expect(flags).toContain("--global");
  });

  it("unregister 声明了 --target 和 --global 选项", () => {
    const unreg = buildProgram().commands.find(
      (c) => c.name() === "unregister",
    );
    expect(unreg).toBeDefined();
    const flags = unreg!.options.map((o) => o.long);
    expect(flags).toContain("--target");
    expect(flags).toContain("--global");
  });
});

describe("runRegister — Claude Code 项目级", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmp();
  });

  it("写入 .mcp.json 包含正确的 igraph 条目", () => {
    runRegister(cwd, { target: "claude" });
    const mcpPath = join(cwd, ".mcp.json");
    expect(existsSync(mcpPath)).toBe(true);
    const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers.igraph).toEqual({
      type: "stdio",
      command: "igraph",
      args: ["serve"],
    });
  });

  it("幂等：二次注册不改变文件内容", () => {
    runRegister(cwd, { target: "claude" });
    const mcpPath = join(cwd, ".mcp.json");
    const first = readFileSync(mcpPath, "utf-8");
    runRegister(cwd, { target: "claude" });
    const second = readFileSync(mcpPath, "utf-8");
    expect(first).toBe(second);
  });

  it("保留已有的其他 MCP 条目", () => {
    const mcpPath = join(cwd, ".mcp.json");
    writeFileSync(
      mcpPath,
      JSON.stringify({
        mcpServers: { other: { command: "other-tool", args: [] } },
      }),
    );
    runRegister(cwd, { target: "claude" });
    const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers.other).toBeDefined();
    expect(content.mcpServers.igraph).toBeDefined();
  });
});

describe("runRegister — Cursor 项目级", () => {
  it("写入 .cursor/mcp.json", () => {
    const cwd = makeTmp();
    runRegister(cwd, { target: "cursor" });
    const mcpPath = join(cwd, ".cursor", "mcp.json");
    expect(existsSync(mcpPath)).toBe(true);
    const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers.igraph).toEqual({
      type: "stdio",
      command: "igraph",
      args: ["serve"],
    });
  });
});

describe("runRegister — JSON 损坏处理", () => {
  it("损坏的 JSON 文件被备份后覆盖", () => {
    const cwd = makeTmp();
    const mcpPath = join(cwd, ".mcp.json");
    writeFileSync(mcpPath, "{ broken json !!!");
    runRegister(cwd, { target: "claude" });
    // 备份存在
    expect(existsSync(`${mcpPath}.bak`)).toBe(true);
    expect(readFileSync(`${mcpPath}.bak`, "utf-8")).toBe("{ broken json !!!");
    // 新文件有效
    const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers.igraph).toBeDefined();
  });
});

describe("runUnregister", () => {
  it("移除 igraph 条目", () => {
    const cwd = makeTmp();
    runRegister(cwd, { target: "claude" });
    runUnregister(cwd, { target: "claude" });
    const mcpPath = join(cwd, ".mcp.json");
    // 文件仅含 igraph，注销后应被删除
    expect(existsSync(mcpPath)).toBe(false);
  });

  it("保留其他条目，仅删除 igraph", () => {
    const cwd = makeTmp();
    const mcpPath = join(cwd, ".mcp.json");
    writeFileSync(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          other: { command: "other" },
          igraph: { type: "stdio", command: "igraph", args: ["serve"] },
        },
      }),
    );
    runUnregister(cwd, { target: "claude" });
    expect(existsSync(mcpPath)).toBe(true);
    const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers.other).toBeDefined();
    expect(content.mcpServers.igraph).toBeUndefined();
  });

  it("未注册时跳过不报错", () => {
    const cwd = makeTmp();
    // 不应抛异常
    expect(() => runUnregister(cwd, { target: "claude" })).not.toThrow();
  });
});

describe("readJsonSafe", () => {
  it("文件不存在返回 exists=false", () => {
    const result = readJsonSafe("/nonexistent/path.json");
    expect(result.exists).toBe(false);
    expect(result.data).toBeNull();
  });

  it("JSON 损坏返回 exists=true, data=null", () => {
    const tmp = makeTmp();
    const path = join(tmp, "bad.json");
    writeFileSync(path, "not json");
    const result = readJsonSafe(path);
    expect(result.exists).toBe(true);
    expect(result.data).toBeNull();
  });

  it("有效 JSON 返回 parsed data", () => {
    const tmp = makeTmp();
    const path = join(tmp, "good.json");
    writeFileSync(path, '{"key": "value"}');
    const result = readJsonSafe(path);
    expect(result.exists).toBe(true);
    expect(result.data).toEqual({ key: "value" });
  });
});
