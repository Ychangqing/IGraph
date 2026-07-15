/**
 * python.test.ts — Python 适配器 5-Pass 解析集成测试
 *
 * 对 tests/fixtures/simple-py-project 运行 parseRepository，
 * 验证 def→function、class→class、__all__ 导出、from-import、
 * 继承（extends）、同文件/同目录调用（calls）、类型引用（refs）。
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseRepository } from "../src/parser/index.js";
import type { ParseResult } from "../src/types/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, "fixtures", "simple-py-project");

async function parseFixture(): Promise<ParseResult> {
  return parseRepository({
    root: FIXTURE_ROOT,
    include: ["**/*"],
    exclude: ["node_modules/**", "dist/**"],
  });
}

describe("parseRepository(python) - files & nodes", () => {
  it("扫描到全部 .py 源文件", async () => {
    const { files } = await parseFixture();
    const paths = files.map((f) => f.filePath).sort();
    expect(paths).toContain("models.py");
    expect(paths).toContain("service.py");
  });

  it("Pass1/2 提取节点并正确分类 kind（def→function、class→class）", async () => {
    const { nodes } = await parseFixture();
    const byName = new Map(nodes.map((n) => [n.name, n]));

    expect(byName.get("normalize")?.kind).toBe("function");
    expect(byName.get("create_user")?.kind).toBe("function");
    expect(byName.get("BaseModel")?.kind).toBe("class");
    expect(byName.get("User")?.kind).toBe("class");
    expect(byName.get("UserService")?.kind).toBe("class");
    expect(byName.get("MAX_USERS")?.kind).toBe("variable");
  });

  it("导出判定：__all__ 优先，否则下划线约定", async () => {
    const { nodes } = await parseFixture();
    const byId = new Map(nodes.map((n) => [n.id, n]));

    // models.py 定义了 __all__ = ["User", "BaseModel"]
    expect(byId.get("models.py#User")?.isExported).toBe(true);
    expect(byId.get("models.py#BaseModel")?.isExported).toBe(true);
    expect(byId.get("models.py#normalize")?.isExported).toBe(false);
    expect(byId.get("models.py#_private_helper")?.isExported).toBe(false);

    // service.py 无 __all__ → 非下划线开头即导出
    expect(byId.get("service.py#create_user")?.isExported).toBe(true);
  });
});

describe("parseRepository(python) - edges", () => {
  it("每个文件生成一个 module 入口节点", async () => {
    const { files, nodes } = await parseFixture();
    const modules = nodes.filter((n) => n.kind === "module");
    expect(modules.length).toBe(files.length);
    for (const f of files) {
      expect(nodes.some((n) => n.id === `${f.filePath}#*`)).toBe(true);
    }
  });

  it("Pass4 生成 calls 边（同文件 + 同目录跨文件）", async () => {
    const { edges } = await parseFixture();
    const idOf = (file: string, name: string): string => `${file}#${name}`;
    const calls = edges.filter((e) => e.kind === "calls");

    // 同文件：bulk_create → create_user
    expect(
      calls.some(
        (e) =>
          e.source === idOf("service.py", "bulk_create") &&
          e.target === idOf("service.py", "create_user"),
      ),
    ).toBe(true);

    // 跨文件同目录：create_user → normalize（models.py）
    expect(
      calls.some(
        (e) =>
          e.source === idOf("service.py", "create_user") &&
          e.target === idOf("models.py", "normalize"),
      ),
    ).toBe(true);
  });

  it("extends 边指向正确目标（类继承）", async () => {
    const { edges } = await parseFixture();
    const extendsEdges = edges.filter((e) => e.kind === "extends");

    // User(BaseModel) —— 同文件
    expect(
      extendsEdges.some(
        (e) =>
          e.source === "models.py#User" && e.target === "models.py#BaseModel",
      ),
    ).toBe(true);

    // UserService(User) —— 同目录跨文件
    expect(
      extendsEdges.some(
        (e) =>
          e.source === "service.py#UserService" &&
          e.target === "models.py#User",
      ),
    ).toBe(true);
  });

  it("Pass5 生成 refs 边（类型引用）", async () => {
    const { edges } = await parseFixture();
    const refs = edges.filter((e) => e.kind === "refs");
    expect(refs.length).toBeGreaterThan(0);
  });
});