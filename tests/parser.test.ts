/**
 * parser.test.ts — 5-Pass 解析流水线集成测试
 *
 * 对 tests/fixtures/simple-ts-project 运行 parseRepository，
 * 验证 Pass1/2 节点、Pass3 imports、Pass4 calls、Pass5 refs、extends/implements。
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseRepository } from "../src/parser/index.js";
import type { ParseResult } from "../src/types/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, "fixtures", "simple-ts-project");

async function parseFixture(): Promise<ParseResult> {
  return parseRepository({
    root: FIXTURE_ROOT,
    include: ["src/**/*"],
    exclude: ["node_modules/**", "dist/**", "**/*.d.ts"],
  });
}

describe("parseRepository - files & nodes", () => {
  it("扫描到全部 fixture 源文件", async () => {
    const { files } = await parseFixture();
    const paths = files.map((f) => f.filePath).sort();
    expect(paths).toContain("src/types.ts");
    expect(paths).toContain("src/service.ts");
    expect(paths).toContain("src/utils.ts");
    expect(paths).toContain("src/UserList.tsx");
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it("Pass1/2 提取节点并正确分类 kind", async () => {
    const { nodes } = await parseFixture();
    const byName = new Map(nodes.map((n) => [n.name, n]));

    expect(byName.get("createUser")?.kind).toBe("function");
    expect(byName.get("normalizeName")?.kind).toBe("function");
    expect(byName.get("UserService")?.kind).toBe("component"); // 大写开头 → component
    expect(byName.get("BaseService")?.kind).toBe("component");
    expect(byName.get("useUsers")?.kind).toBe("hook"); // use 开头
    expect(byName.get("UserListView")?.kind).toBe("component");
    expect(byName.get("User")?.kind).toBe("type");
    expect(byName.get("UserList")?.kind).toBe("type");

    // isExported 标记
    expect(byName.get("createUser")?.isExported).toBe(true);
    expect(byName.get("normalizeName")?.isExported).toBe(false);
  });
});

describe("parseRepository - edges", () => {
  it("Pass3 生成 imports 边", async () => {
    const { edges, nodes } = await parseFixture();
    const imports = edges.filter((e) => e.kind === "imports");
    expect(imports.length).toBeGreaterThan(0);

    // imports 边的 source 均为文件入口节点（`${filePath}#*`），且该节点已作为
    // kind=module 节点存在，保证落库时 source 可映射为真实 node id。
    for (const e of imports) {
      expect(e.source.endsWith("#*")).toBe(true);
      const src = nodes.find((n) => n.id === e.source);
      expect(src).toBeDefined();
      expect(src?.kind).toBe("module");
    }
  });

  it("每个文件生成一个 module 入口节点", async () => {
    const { files, nodes } = await parseFixture();
    const modules = nodes.filter((n) => n.kind === "module");
    // 每个被扫描且有适配器的文件都应有一个 module 节点
    expect(modules.length).toBe(files.length);
    for (const f of files) {
      expect(nodes.some((n) => n.id === `${f.filePath}#*`)).toBe(true);
    }
  });

  it("Pass4 生成 calls 边（同文件 + 跨文件）", async () => {
    const { edges, nodes } = await parseFixture();
    const idOf = (file: string, name: string): string => `${file}#${name}`;
    const calls = edges.filter((e) => e.kind === "calls");

    // 同文件：createUser → normalizeName
    expect(
      calls.some(
        (e) =>
          e.source === idOf("src/service.ts", "createUser") &&
          e.target === idOf("src/service.ts", "normalizeName"),
      ),
    ).toBe(true);

    // 跨文件（import）：createUsers → createUser
    expect(
      calls.some(
        (e) =>
          e.source === idOf("src/utils.ts", "createUsers") &&
          e.target === idOf("src/service.ts", "createUser"),
      ),
    ).toBe(true);

    void nodes;
  });

  it("extends / implements 边指向正确目标", async () => {
    const { edges } = await parseFixture();
    const extendsEdges = edges.filter((e) => e.kind === "extends");
    const implEdges = edges.filter((e) => e.kind === "implements");

    // UserService extends BaseService
    expect(
      extendsEdges.some(
        (e) =>
          e.source === "src/service.ts#UserService" &&
          e.target === "src/types.ts#BaseService",
      ),
    ).toBe(true);

    // UserService implements Repository
    expect(implEdges.length).toBeGreaterThan(0);
  });

  it("Pass5 生成 refs 边（含 JSX 组件引用）", async () => {
    const { edges } = await parseFixture();
    const refs = edges.filter((e) => e.kind === "refs");
    expect(refs.length).toBeGreaterThan(0);
  });
});