/**
 * cli/mount.ts — `igraph mount` 命令（M7 多模态挂载）
 *
 * 提供两个子命令：
 *   - `igraph mount prd <file>`：挂载 PRD 文档（.md/.markdown/.txt/.pdf/.docx），
 *     按标题切分为需求点，建立 describes 边到相关代码文件。
 *   - `igraph mount db <file>`：挂载 DB Schema（.sql/.ddl/.json/.xlsx），按表
 *     切分，建立 reads 边到相关代码文件。
 *
 * 凭据从环境变量 IGRAPH_API_KEY 注入；缺失时优雅降级（仅落库，跳过向量化与
 * 建边），对齐 query/build 的降级策略。不支持的格式（.doc 等）由解析层抛
 * UnsupportedFormatError，此处捕获并给出友好提示后正常退出（非崩溃）。
 */
import { resolve } from "node:path";
import { Command } from "commander";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../config/index.js";
import { openDatabase, closeDatabase } from "../graph/index.js";
import {
  mountDb,
  mountPrd,
  type MountResult,
} from "../multimodal/index.js";
import { UnsupportedFormatError } from "../multimodal/types.js";

interface MountCliOptions {
  topK?: number;
}

export function registerMount(program: Command): void {
  const mount = program
    .command("mount")
    .description("挂载多模态资源（PRD / DB Schema）并关联到代码文件");

  mount
    .command("prd")
    .description(
      "挂载 PRD 文档（.md/.markdown/.txt/.pdf/.docx），按标题切分为需求点",
    )
    .argument("<file>", "PRD 文件路径（.md/.markdown/.txt/.pdf/.docx）")
    .option("--top-k <n>", "每个切片检索的候选文件数", (v) =>
      Number.parseInt(v, 10),
    )
    .action(async (file: string, opts: MountCliOptions) => {
      await runMount("prd", file, opts);
    });

  mount
    .command("db")
    .description("挂载 DB Schema（.sql/.ddl/.json/.xlsx），按表切分")
    .argument("<file>", "DB Schema 文件路径（.sql/.ddl/.json/.xlsx）")
    .option("--top-k <n>", "每个切片检索的候选文件数", (v) =>
      Number.parseInt(v, 10),
    )
    .action(async (file: string, opts: MountCliOptions) => {
      await runMount("db", file, opts);
    });
}

/** 执行挂载：加载配置（免密钥降级）→ 打开库 → 调用主流程 → 输出结果 */
async function runMount(
  kind: "prd" | "db",
  file: string,
  opts: MountCliOptions,
): Promise<void> {
  const cwd = process.cwd();
  // 挂载支持降级，不强制 API Key（对齐 query）。
  const config = loadConfig(cwd, false);
  const sourcePath = resolve(cwd, file);
  const topK = opts.topK && opts.topK > 0 ? opts.topK : undefined;

  const db = openDatabase(cwd);
  try {
    let result: MountResult;
    if (kind === "prd") {
      result = await mountPrd(db, config, sourcePath, { topK });
    } else {
      result = await mountDb(db, config, sourcePath, { topK });
    }
    reportResult(result);
  } catch (err) {
    if (err instanceof UnsupportedFormatError) {
      logger.warn(err.message);
      return;
    }
    throw err;
  } finally {
    closeDatabase(db);
  }
}

/** 输出挂载结果摘要 */
function reportResult(r: MountResult): void {
  const label = r.type === "prd" ? "PRD" : "DB Schema";
  logger.info(
    `已挂载 ${label}：${r.sourcePath}\n` +
      `  资源切片：${r.resources}\n` +
      `  向量化：${r.embedded ? "是" : "否"}\n` +
      `  关联边：${r.edges}（strong ${r.strong} / weak ${r.weak}）`,
  );
  if (r.note) logger.warn(r.note);
}