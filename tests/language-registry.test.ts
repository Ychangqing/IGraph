/**
 * language-registry.test.ts — 语言注册表单元测试
 *
 * 验证 detectLanguage / getAdapterForFile / getAdapterById / registerBuiltinAdapters
 * 对各语言扩展名的映射，以及不支持的语言返回 undefined。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  detectLanguage,
  getAdapterForFile,
  getAdapterById,
} from "../src/parser/languages/registry.js";
import { registerBuiltinAdapters } from "../src/parser/index.js";

beforeEach(() => {
  registerBuiltinAdapters();
});

describe("detectLanguage", () => {
  it("Python 文件正确识别", () => {
    expect(detectLanguage("foo.py")).toBe("python");
    expect(detectLanguage("foo.pyi")).toBe("python");
    expect(detectLanguage("src/models.py")).toBe("python");
  });

  it("TypeScript 文件正确识别", () => {
    expect(detectLanguage("foo.ts")).toBe("typescript");
    expect(detectLanguage("foo.tsx")).toBe("typescript");
    expect(detectLanguage("foo.mts")).toBe("typescript");
    expect(detectLanguage("foo.cts")).toBe("typescript");
  });

  it("JavaScript 文件正确识别", () => {
    expect(detectLanguage("foo.js")).toBe("javascript");
    expect(detectLanguage("foo.jsx")).toBe("javascript");
    expect(detectLanguage("foo.mjs")).toBe("javascript");
    expect(detectLanguage("foo.cjs")).toBe("javascript");
  });

  it("Java 文件正确识别", () => {
    expect(detectLanguage("Main.java")).toBe("java");
  });

  it("Go 文件正确识别", () => {
    expect(detectLanguage("main.go")).toBe("go");
    expect(detectLanguage("pkg/user_service.go")).toBe("go");
  });

  it("不支持的语言返回 undefined", () => {
    expect(detectLanguage("lib.rs")).toBeUndefined();
    expect(detectLanguage("app.rb")).toBeUndefined();
    expect(detectLanguage("file.c")).toBeUndefined();
    expect(detectLanguage("file.cpp")).toBeUndefined();
  });

  it("无扩展名文件返回 undefined", () => {
    expect(detectLanguage("Makefile")).toBeUndefined();
    expect(detectLanguage("Dockerfile")).toBeUndefined();
  });
});

describe("getAdapterForFile", () => {
  it("Python 文件返回 python adapter", () => {
    const adapter = getAdapterForFile("models.py");
    expect(adapter).toBeDefined();
    expect(adapter!.id).toBe("python");
    expect(adapter!.extensions).toContain(".py");
  });

  it("TypeScript 文件返回 typescript adapter", () => {
    const adapter = getAdapterForFile("index.ts");
    expect(adapter).toBeDefined();
    expect(adapter!.id).toBe("typescript");
  });

  it("Java 文件返回 java adapter", () => {
    const adapter = getAdapterForFile("Main.java");
    expect(adapter).toBeDefined();
    expect(adapter!.id).toBe("java");
    expect(adapter!.extensions).toContain(".java");
  });

  it("Go 文件返回 go adapter", () => {
    const adapter = getAdapterForFile("main.go");
    expect(adapter).toBeDefined();
    expect(adapter!.id).toBe("go");
    expect(adapter!.extensions).toContain(".go");
  });

  it("不支持的文件返回 undefined", () => {
    expect(getAdapterForFile("lib.rs")).toBeUndefined();
  });
});

describe("getAdapterById", () => {
  it("已注册的 id 返回对应 adapter", () => {
    expect(getAdapterById("python")?.id).toBe("python");
    expect(getAdapterById("typescript")?.id).toBe("typescript");
    expect(getAdapterById("javascript")?.id).toBe("javascript");
    expect(getAdapterById("java")?.id).toBe("java");
    expect(getAdapterById("go")?.id).toBe("go");
  });

  it("未注册的 id 返回 undefined", () => {
    expect(getAdapterById("rust")).toBeUndefined();
  });
});

describe("registerBuiltinAdapters", () => {
  it("注册所有内置语言后所有扩展名可解析", () => {
    registerBuiltinAdapters();
    // TS: 4 种扩展名
    for (const ext of [".ts", ".tsx", ".mts", ".cts"]) {
      expect(detectLanguage(`file${ext}`)).toBe("typescript");
    }
    // JS: 4 种扩展名
    for (const ext of [".js", ".jsx", ".mjs", ".cjs"]) {
      expect(detectLanguage(`file${ext}`)).toBe("javascript");
    }
    // Python: 2 种扩展名
    for (const ext of [".py", ".pyi"]) {
      expect(detectLanguage(`file${ext}`)).toBe("python");
    }
    // Java: 1 种扩展名
    expect(detectLanguage("file.java")).toBe("java");
    // Go: 1 种扩展名
    expect(detectLanguage("file.go")).toBe("go");
  });

  it("grammarFor 对 .tsx 返回 tsx, 对 .ts 返回 typescript", () => {
    const adapter = getAdapterForFile("comp.tsx");
    expect(adapter).toBeDefined();
    expect(adapter!.grammarFor("comp.tsx")).toBe("tsx");
    expect(adapter!.grammarFor("util.ts")).toBe("typescript");
  });

  it("Python adapter grammarFor 始终返回 python", () => {
    const adapter = getAdapterForFile("app.py");
    expect(adapter).toBeDefined();
    expect(adapter!.grammarFor("app.py")).toBe("python");
    expect(adapter!.grammarFor("types.pyi")).toBe("python");
  });
});
