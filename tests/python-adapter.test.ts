/**
 * python-adapter.test.ts — Python 适配器 5 个 extract 方法的单元测试
 *
 * 直接用 tree-sitter 解析内联 Python 源码，调用 adapter 方法验证边界场景：
 * __all__ 边界、relative import、alias import、多继承、装饰器、方法调用等。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../src/parser/tree-sitter.js";
import {
  extractExports,
  extractInternalSymbols,
  extractImports,
  extractCalls,
  extractRefs,
} from "../src/parser/languages/python.js";

function pyTree(source: string) {
  return parse(source, "python");
}

describe("Python extractExports / extractInternalSymbols", () => {
  it("无 __all__ 时非下划线开头全部导出", () => {
    const tree = pyTree(`
def public_func():
    pass

def _private_func():
    pass

class PublicClass:
    pass
`);
    const exports = extractExports(tree.rootNode);
    const internals = extractInternalSymbols(tree.rootNode);
    const exportNames = exports.map((e) => e.name);
    const internalNames = internals.map((i) => i.name);
    expect(exportNames).toContain("public_func");
    expect(exportNames).toContain("PublicClass");
    expect(exportNames).not.toContain("_private_func");
    expect(internalNames).toContain("_private_func");
    expect(internalNames).not.toContain("public_func");
  });

  it("__all__ = [] 时所有顶层定义均为内部", () => {
    const tree = pyTree(`
__all__ = []

def foo():
    pass

class Bar:
    pass
`);
    const exports = extractExports(tree.rootNode);
    const internals = extractInternalSymbols(tree.rootNode);
    expect(exports.length).toBe(0);
    expect(internals.map((i) => i.name)).toContain("foo");
    expect(internals.map((i) => i.name)).toContain("Bar");
  });

  it("__all__ 包含变量名时正确标记导出", () => {
    const tree = pyTree(`
__all__ = ["MY_VAR"]

MY_VAR = 42

def helper():
    pass
`);
    const exports = extractExports(tree.rootNode);
    const internals = extractInternalSymbols(tree.rootNode);
    expect(exports.map((e) => e.name)).toContain("MY_VAR");
    expect(exports.map((e) => e.name)).not.toContain("helper");
    expect(internals.map((i) => i.name)).toContain("helper");
  });

  it("class 提取 kind=class 且签名正确", () => {
    const tree = pyTree(`
class MyClass:
    def method(self):
        pass
`);
    const exports = extractExports(tree.rootNode);
    const cls = exports.find((e) => e.name === "MyClass");
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe("class");
    expect(cls!.signature).toBe("class MyClass");
  });

  it("function 提取签名含参数和返回类型", () => {
    const tree = pyTree(`
def greet(name: str, age: int) -> str:
    return f"hello {name}"
`);
    const exports = extractExports(tree.rootNode);
    const fn = exports.find((e) => e.name === "greet");
    expect(fn).toBeDefined();
    expect(fn!.kind).toBe("function");
    expect(fn!.signature).toContain("name: str");
    expect(fn!.signature).toContain("-> str");
  });
});

describe("Python extractImports", () => {
  it("from . import x 生成相对导入", () => {
    const tree = pyTree(`from . import utils`);
    const imports = extractImports(tree.rootNode);
    expect(imports.length).toBe(1);
    expect(imports[0]!.moduleSpecifier).toBe(".");
    expect(imports[0]!.bindings[0]!.imported).toBe("utils");
  });

  it("import numpy as np 生成别名导入", () => {
    const tree = pyTree(`import numpy as np`);
    const imports = extractImports(tree.rootNode);
    expect(imports.length).toBe(1);
    expect(imports[0]!.moduleSpecifier).toBe("numpy");
    expect(imports[0]!.bindings[0]!.local).toBe("np");
  });

  it("from x import * 生成 wildcard", () => {
    const tree = pyTree(`from models import *`);
    const imports = extractImports(tree.rootNode);
    expect(imports.length).toBe(1);
    expect(imports[0]!.kind).toBe("namespace");
    expect(imports[0]!.bindings[0]!.imported).toBe("*");
    expect(imports[0]!.bindings[0]!.local).toBe("*");
  });

  it("import os.path 生成点分导入", () => {
    const tree = pyTree(`import os.path`);
    const imports = extractImports(tree.rootNode);
    expect(imports.length).toBe(1);
    expect(imports[0]!.moduleSpecifier).toBe("os.path");
    expect(imports[0]!.bindings[0]!.local).toBe("path");
  });

  it("from ..models import User 生成相对导入", () => {
    const tree = pyTree(`from ..models import User`);
    const imports = extractImports(tree.rootNode);
    expect(imports.length).toBe(1);
    expect(imports[0]!.moduleSpecifier).toBe("..models");
    expect(imports[0]!.bindings[0]!.imported).toBe("User");
  });

  it("from mod import a, b 提取多个 binding", () => {
    const tree = pyTree(`from mod import a, b`);
    const imports = extractImports(tree.rootNode);
    expect(imports.length).toBe(1);
    const names = imports[0]!.bindings.map((b) => b.imported);
    expect(names).toContain("a");
    expect(names).toContain("b");
  });
});

describe("Python extractCalls", () => {
  it("obj.method() 提取 calleeName = method", () => {
    const tree = pyTree(`
def foo():
    result.save()
`);
    const calls = extractCalls(tree.rootNode);
    const save = calls.find((c) => c.calleeName === "save");
    expect(save).toBeDefined();
    expect(save!.enclosingSymbol).toBe("foo");
  });

  it("函数内调用包含 enclosingSymbol", () => {
    const tree = pyTree(`
def outer():
    inner()
`);
    const calls = extractCalls(tree.rootNode);
    const inner = calls.find((c) => c.calleeName === "inner");
    expect(inner).toBeDefined();
    expect(inner!.enclosingSymbol).toBe("outer");
  });

  it("模块级调用无 enclosingSymbol", () => {
    const tree = pyTree(`print("hello")`);
    const calls = extractCalls(tree.rootNode);
    const p = calls.find((c) => c.calleeName === "print");
    expect(p).toBeDefined();
    expect(p!.enclosingSymbol).toBeUndefined();
  });
});

describe("Python extractRefs", () => {
  it("类型注解产生 refs", () => {
    const tree = pyTree(`
def greet(user: User) -> str:
    pass
`);
    const refs = extractRefs(tree.rootNode);
    const userRef = refs.find((r) => r.name === "User");
    expect(userRef).toBeDefined();
    expect(userRef!.refKind).toBe("type");
  });

  it("class 继承基类产生 refs", () => {
    const tree = pyTree(`
class Foo(Bar, Baz):
    pass
`);
    const refs = extractRefs(tree.rootNode);
    const names = refs.map((r) => r.name);
    expect(names).toContain("Bar");
    expect(names).toContain("Baz");
  });

  it("多继承 extractExports 正确设置 extendsName 和 implementsNames", () => {
    const tree = pyTree(`
class Foo(Bar, Baz):
    pass
`);
    const exports = extractExports(tree.rootNode);
    const foo = exports.find((e) => e.name === "Foo");
    expect(foo).toBeDefined();
    expect(foo!.extendsName).toBe("Bar");
    expect(foo!.implementsNames).toEqual(["Baz"]);
  });

  it("装饰器产生 refs", () => {
    const tree = pyTree(`
@my_decorator
def handler():
    pass
`);
    const refs = extractRefs(tree.rootNode);
    const deco = refs.find((r) => r.name === "my_decorator");
    expect(deco).toBeDefined();
    expect(deco!.refKind).toBe("type");
  });

  it("decorated 函数的起始行包含装饰器行", () => {
    const tree = pyTree(`
@my_decorator
def handler():
    pass
`);
    const exports = extractExports(tree.rootNode);
    const handler = exports.find((e) => e.name === "handler");
    expect(handler).toBeDefined();
    // @my_decorator 在第 2 行，def handler 在第 3 行
    // startLine 应是装饰器行（wrapper 的起始行）
    expect(handler!.startLine).toBe(2);
  });
});
