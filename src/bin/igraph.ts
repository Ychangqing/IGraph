#!/usr/bin/env node
/**
 * bin/igraph.ts — CLI 可执行入口
 *
 * 首行 shebang 必须保留，打包后 dist/igraph.js 依赖它作为可执行文件头。
 */
import { buildProgram } from "../cli/index.js";

const program = buildProgram();
program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});