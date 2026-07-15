/**
 * go-adapter.test.ts — Go 适配器 5 个 extract 方法的单元测试
 *
 * 直接用 tree-sitter 解析内联 Go 源码，调用 adapter 方法验证：
 * 首字母大写/小写的 export/internal 判定、struct/interface kind、method receiver、
 * import 解析、函数调用、类型引用。
 * 同时用真实 fixture 文件跑一遍完整解析，确认 root=source_file 且 native ABI 无崩溃。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "../src/parser/tree-sitter.js";
import {
  extractExports,
  extractInternalSymbols,
  extractImports,
  extractCalls,
  extractRefs,
} from "../src/parser/languages/go.js";

function goTree(source: string) {
  return parse(source, "go");
}

describe("Go extractExports / extractInternalSymbols（首字母大写判定）", () => {
  it("首字母大写函数/类型导出，小写为内部", () => {
    const tree = goTree(`
package p

func Exported() {}

func internal() {}

type Public struct {}

type private struct {}
`);
    const exportNames = extractExports(tree.rootNode).map((e) => e.name);
    const internalNames = extractInternalSymbols(tree.rootNode).map((i) => i.name);
    // 首字母大写 → 导出
    expect(exportNames).toContain("Exported");
    expect(exportNames).toContain("Public");
    // 首字母小写 → 内部
    expect(internalNames).toContain("internal");
    expect(internalNames).toContain("private");
    // 交叉断言
    expect(exportNames).not.toContain("internal");
    expect(internalNames).not.toContain("Exported");
  });

  it("struct kind=class, interface kind=type", () => {
    const tree = goTree(`
package p

type Point struct { X int }

type Shape interface { Area() float64 }
`);
    const exports = extractExports(tree.rootNode);
    const point = exports.find((e) => e.name === "Point");
    const shape = exports.find((e) => e.name === "Shape");
    expect(point).toBeDefined();
    expect(point!.kind).toBe("class");
    expect(point!.signature).toBe("struct Point");
    expect(shape).toBeDefined();
    expect(shape!.kind).toBe("type");
    expect(shape!.signature).toBe("type Shape");
  });

  it("导出函数 kind=function 且签名含参数与返回类型", () => {
    const tree = goTree(`
package p

func Greet(name string, age int) string { return name }
`);
    const greet = extractExports(tree.rootNode).find((e) => e.name === "Greet");
    expect(greet).toBeDefined();
    expect(greet!.kind).toBe("function");
    expect(greet!.signature).toContain("name string");
    expect(greet!.signature).toContain("string");
  });

  it("method（含 receiver）kind=method，首字母大写导出", () => {
    const tree = goTree(`
package p

type S struct {}

func (s *S) Run() {}

func (s *S) helper() {}
`);
    const exports = extractExports(tree.rootNode);
    const internals = extractInternalSymbols(tree.rootNode);
    const run = exports.find((e) => e.name === "Run");
    expect(run).toBeDefined();
    expect(run!.kind).toBe("method");
    expect(run!.signature).toContain("(s *S)");
    // 小写 method 为内部
    expect(internals.map((i) => i.name)).toContain("helper");
  });

  it("const/var 首字母大小写判定导出", () => {
    const tree = goTree(`
package p

const MaxSize = 10

const minSize = 1

var GlobalCount int

var localCount int
`);
    const exportNames = extractExports(tree.rootNode).map((e) => e.name);
    const internalNames = extractInternalSymbols(tree.rootNode).map((i) => i.name);
    expect(exportNames).toContain("MaxSize");
    expect(exportNames).toContain("GlobalCount");
    expect(internalNames).toContain("minSize");
    expect(internalNames).toContain("localCount");
  });
});

describe("Go extractImports", () => {
  it("单行 import 生成 named，本地名取路径末段", () => {
    const tree = goTree(`
package p
import "math/rand"
`);
    const imports = extractImports(tree.rootNode);
    expect(imports.length).toBe(1);
    expect(imports[0]!.moduleSpecifier).toBe("math/rand");
    expect(imports[0]!.kind).toBe("named");
    expect(imports[0]!.bindings[0]!.local).toBe("rand");
  });

  it("括号分组 import 与别名解析", () => {
    const tree = goTree(`
package p
import (
	"fmt"
	rnd "math/rand"
)
`);
    const imports = extractImports(tree.rootNode);
    const specs = imports.map((i) => i.moduleSpecifier);
    expect(specs).toContain("fmt");
    expect(specs).toContain("math/rand");
    const aliased = imports.find((i) => i.moduleSpecifier === "math/rand");
    expect(aliased!.bindings[0]!.local).toBe("rnd");
  });
});

describe("Go extractCalls", () => {
  it("函数内直接调用包含 enclosingSymbol", () => {
    const tree = goTree(`
package p
func outer() {
	inner()
}
`);
    const inner = extractCalls(tree.rootNode).find((c) => c.calleeName === "inner");
    expect(inner).toBeDefined();
    expect(inner!.enclosingSymbol).toBe("outer");
  });

  it("selector 调用 obj.Method() 取末段方法名", () => {
    const tree = goTree(`
package p
func run() {
	fmt.Println("x")
}
`);
    const println = extractCalls(tree.rootNode).find((c) => c.calleeName === "Println");
    expect(println).toBeDefined();
    expect(println!.enclosingSymbol).toBe("run");
  });
});

describe("Go extractRefs", () => {
  it("参数与返回类型产生 type refs", () => {
    const tree = goTree(`
package p
func handle(u User) Result { return Result{} }
`);
    const refs = extractRefs(tree.rootNode);
    const names = refs.map((r) => r.name);
    expect(names).toContain("User");
    expect(names).toContain("Result");
    const userRef = refs.find((r) => r.name === "User");
    expect(userRef!.refKind).toBe("type");
    expect(userRef!.enclosingSymbol).toBe("handle");
  });
});

describe("Go fixture 真实解析（native ABI 冒烟）", () => {
  it("解析 user_service.go 无崩溃，root=source_file 且导出判定正确", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(dir, "fixtures/simple-go-project/user_service.go"),
      "utf8",
    );
    const tree = goTree(src);
    // 断言 root 节点类型（确认 grammar 正确加载，无 ABI 崩溃）
    expect(tree.rootNode.type).toBe("source_file");

    const exports = extractExports(tree.rootNode).map((e) => e.name);
    const internals = extractInternalSymbols(tree.rootNode).map((i) => i.name);
    // 首字母大写 → 导出
    expect(exports).toContain("UserService");
    expect(exports).toContain("FindUser");
    expect(exports).toContain("Exported");
    expect(exports).toContain("Repository");
    expect(exports).toContain("MaxRetries");
    // 首字母小写 → 内部
    expect(internals).toContain("loadUser");
    expect(internals).toContain("helper");
    expect(internals).toContain("internalSeed");

    const calls = extractCalls(tree.rootNode);
    expect(calls.find((c) => c.calleeName === "loadUser")).toBeDefined();
    expect(calls.find((c) => c.calleeName === "helper")).toBeDefined();

    const imports = extractImports(tree.rootNode).map((i) => i.moduleSpecifier);
    expect(imports).toContain("fmt");
    expect(imports).toContain("math/rand");
  });
});