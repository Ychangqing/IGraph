/**
 * java-adapter.test.ts — Java 适配器 5 个 extract 方法的单元测试
 *
 * 直接用 tree-sitter 解析内联 Java 源码，调用 adapter 方法验证：
 * public/非public 的 export/internal 判定、import 解析、方法调用、类型引用、继承。
 * 同时用真实 fixture 文件跑一遍完整解析，确认 native ABI 无崩溃。
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
} from "../src/parser/languages/java.js";

function javaTree(source: string) {
  return parse(source, "java");
}

describe("Java extractExports / extractInternalSymbols", () => {
  it("public class/method/field 导出，非 public 为内部", () => {
    const tree = javaTree(`
public class Service {
    public int count;
    private String name;

    public void run() {}

    private void helper() {}
}

class InternalClass {}
`);
    const exports = extractExports(tree.rootNode);
    const internals = extractInternalSymbols(tree.rootNode);
    const exportNames = exports.map((e) => e.name);
    const internalNames = internals.map((i) => i.name);
    // public 导出
    expect(exportNames).toContain("Service");
    expect(exportNames).toContain("count");
    expect(exportNames).toContain("run");
    // 非 public 为内部
    expect(internalNames).toContain("name");
    expect(internalNames).toContain("helper");
    expect(internalNames).toContain("InternalClass");
    // 交叉断言
    expect(exportNames).not.toContain("helper");
    expect(internalNames).not.toContain("Service");
  });

  it("public class kind=class 且签名正确", () => {
    const tree = javaTree(`public class Foo {}`);
    const exports = extractExports(tree.rootNode);
    const foo = exports.find((e) => e.name === "Foo");
    expect(foo).toBeDefined();
    expect(foo!.kind).toBe("class");
    expect(foo!.signature).toBe("class Foo");
  });

  it("public interface kind=type", () => {
    const tree = javaTree(`public interface Repo {}`);
    const exports = extractExports(tree.rootNode);
    const repo = exports.find((e) => e.name === "Repo");
    expect(repo).toBeDefined();
    expect(repo!.kind).toBe("type");
    expect(repo!.signature).toBe("interface Repo");
  });

  it("public enum kind=class", () => {
    const tree = javaTree(`public enum Status { OK, FAIL }`);
    const exports = extractExports(tree.rootNode);
    const s = exports.find((e) => e.name === "Status");
    expect(s).toBeDefined();
    expect(s!.kind).toBe("class");
    expect(s!.signature).toBe("enum Status");
  });

  it("public method kind=method 且签名含参数与返回类型", () => {
    const tree = javaTree(`
public class C {
    public String greet(String name, int age) { return name; }
}
`);
    const exports = extractExports(tree.rootNode);
    const m = exports.find((e) => e.name === "greet");
    expect(m).toBeDefined();
    expect(m!.kind).toBe("method");
    expect(m!.signature).toContain("String name");
    expect(m!.signature).toContain(": String");
  });
});

describe("Java extractImports", () => {
  it("import java.util.List 生成 named 导入", () => {
    const tree = javaTree(`import java.util.List;`);
    const imports = extractImports(tree.rootNode);
    expect(imports.length).toBe(1);
    expect(imports[0]!.moduleSpecifier).toBe("java.util.List");
    expect(imports[0]!.kind).toBe("named");
    expect(imports[0]!.bindings[0]!.local).toBe("List");
  });

  it("import java.util.* 生成 wildcard/namespace", () => {
    const tree = javaTree(`import java.util.*;`);
    const imports = extractImports(tree.rootNode);
    expect(imports.length).toBe(1);
    expect(imports[0]!.kind).toBe("namespace");
    expect(imports[0]!.bindings[0]!.imported).toBe("*");
  });

  it("static import 也被解析", () => {
    const tree = javaTree(`import static java.lang.Math.max;`);
    const imports = extractImports(tree.rootNode);
    expect(imports.length).toBe(1);
    expect(imports[0]!.moduleSpecifier).toBe("java.lang.Math.max");
    expect(imports[0]!.bindings[0]!.local).toBe("max");
  });
});

describe("Java extractCalls", () => {
  it("方法内调用包含 enclosingSymbol", () => {
    const tree = javaTree(`
public class C {
    public void outer() {
        inner();
    }
}
`);
    const calls = extractCalls(tree.rootNode);
    const inner = calls.find((c) => c.calleeName === "inner");
    expect(inner).toBeDefined();
    expect(inner!.enclosingSymbol).toBe("outer");
  });

  it("obj.method() 提取 calleeName = method", () => {
    const tree = javaTree(`
public class C {
    public void run() {
        repo.save();
    }
}
`);
    const calls = extractCalls(tree.rootNode);
    const save = calls.find((c) => c.calleeName === "save");
    expect(save).toBeDefined();
    expect(save!.enclosingSymbol).toBe("run");
  });
});

describe("Java extractRefs / 继承", () => {
  it("class 继承与实现产生 refs 及 extends/implements", () => {
    const tree = javaTree(`
public class Foo extends Bar implements Baz {
}
`);
    const refs = extractRefs(tree.rootNode);
    const names = refs.map((r) => r.name);
    expect(names).toContain("Bar");
    expect(names).toContain("Baz");

    const exports = extractExports(tree.rootNode);
    const foo = exports.find((e) => e.name === "Foo");
    expect(foo!.extendsName).toBe("Bar");
    expect(foo!.implementsNames).toEqual(["Baz"]);
  });

  it("方法参数类产生 type refs", () => {
    const tree = javaTree(`
public class C {
    public void handle(User user) {}
}
`);
    const refs = extractRefs(tree.rootNode);
    const userRef = refs.find((r) => r.name === "User");
    expect(userRef).toBeDefined();
    expect(userRef!.refKind).toBe("type");
    expect(userRef!.enclosingSymbol).toBe("handle");
  });
});

describe("Java fixture 真实解析（native ABI 冒烟）", () => {
  it("解析 UserService.java 无崩溃且判定正确", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(dir, "fixtures/simple-java-project/UserService.java"),
      "utf8",
    );
    const tree = javaTree(src);
    const exports = extractExports(tree.rootNode).map((e) => e.name);
    const internals = extractInternalSymbols(tree.rootNode).map((i) => i.name);
    expect(exports).toContain("UserService");
    expect(exports).toContain("total");
    expect(exports).toContain("findUser");
    expect(internals).toContain("secret");
    expect(internals).toContain("loadUser");
    expect(internals).toContain("InternalHelper");

    const calls = extractCalls(tree.rootNode);
    expect(calls.find((c) => c.calleeName === "loadUser")).toBeDefined();

    const imports = extractImports(tree.rootNode).map((i) => i.moduleSpecifier);
    expect(imports).toContain("java.util.List");
    expect(imports).toContain("com.demo.model.User");
  });
});