/**
 * graph/db.ts — SQLite 数据库连接管理
 *
 * 职责：
 * 1. 打开 / 创建 `.igraph/igraph.db`（自动建立父目录）。
 * 2. 启用 WAL 日志模式与外键约束。
 * 3. 加载 sqlite-vec 扩展（失败时给出清晰错误提示）。
 * 4. 执行 Schema 迁移（migrate）。
 *
 * 使用同步驱动 better-sqlite3：CLI 场景无并发压力，同步 API 更简单可靠，
 * 且支持 loadExtension 以挂载 sqlite-vec 原生扩展。
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { CONFIG_DIR } from "../config/index.js";
import { migrate } from "./schema.js";

/** 数据库文件名 */
export const DB_FILE = "igraph.db";

/** better-sqlite3 Database 实例类型别名（供其他模块标注） */
export type DB = Database.Database;

/** 打开数据库时的可选项 */
export interface OpenDatabaseOptions {
  /** 是否只读打开（默认 false） */
  readonly?: boolean;
  /** 是否执行 Schema 迁移（默认 true） */
  migrate?: boolean;
  /** better-sqlite3 verbose 日志回调（调试用）*/
  verbose?: (message?: unknown, ...args: unknown[]) => void;
}

/** 返回 `<cwd>/.igraph/igraph.db` 的绝对路径 */
export function getDatabasePath(cwd: string = process.cwd()): string {
  return join(cwd, CONFIG_DIR, DB_FILE);
}

/**
 * 加载 sqlite-vec 扩展。失败时抛出带清晰提示的错误。
 */
function loadVecExtension(db: DB): void {
  try {
    sqliteVec.load(db);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      "加载 sqlite-vec 向量扩展失败：" +
        detail +
        "\n请确认已安装依赖 `sqlite-vec` 及对应平台的预编译包，" +
        "或当前平台是否受支持（darwin/linux/windows x64/arm64）。",
    );
  }
}

/**
 * 打开（或创建）指定路径的数据库文件并完成初始化。
 *
 * @param dbPath 数据库文件绝对路径
 * @param options 打开选项
 */
export function openDatabaseAt(
  dbPath: string,
  options: OpenDatabaseOptions = {},
): DB {
  const { readonly = false, migrate: doMigrate = true, verbose } = options;

  // 确保父目录存在
  mkdirSync(dirname(dbPath), { recursive: true });

  let db: DB;
  try {
    db = new Database(dbPath, {
      readonly,
      // better-sqlite3 v11 默认允许 loadExtension；显式声明以确保可加载 sqlite-vec
      ...(verbose ? { verbose } : {}),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`打开数据库失败（${dbPath}）：${detail}`);
  }

  // 加载向量扩展（必须在建向量虚拟表之前）
  loadVecExtension(db);

  // 连接级 PRAGMA
  if (!readonly) {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");

  if (doMigrate && !readonly) {
    migrate(db);
  }

  return db;
}

/**
 * 打开当前工作目录下的 IGraph 数据库。
 *
 * @param cwd 工作目录（默认 process.cwd()）
 * @param options 打开选项
 */
export function openDatabase(
  cwd: string = process.cwd(),
  options: OpenDatabaseOptions = {},
): DB {
  return openDatabaseAt(getDatabasePath(cwd), options);
}

/**
 * 打开内存数据库（供测试使用）：加载扩展并迁移，但不落盘。
 */
export function openMemoryDatabase(): DB {
  const db = new Database(":memory:");
  loadVecExtension(db);
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

/** 安全关闭数据库连接 */
export function closeDatabase(db: DB): void {
  if (db.open) db.close();
}