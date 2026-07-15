import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    igraph: "src/bin/igraph.ts",
  },
  format: ["esm", "cjs"],
  target: "node18",
  outDir: "dist",
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  shims: true,
  // bin/igraph.ts 首行自带 shebang，tsup 会自动保留并给产物加可执行权限
});