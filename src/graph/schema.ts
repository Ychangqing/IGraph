/**
 * graph/schema.ts — SQLite Schema 定义与版本迁移
 *
 * 职责：
 * 1. 提供完整的 IGraph SQLite Schema（见规划第三节 3.1）。
 * 2. 提供基于 metadata.schema_version 的顺序迁移机制。
 *
 * 迁移机制：
 * - 每个 schema 版本对应 MIGRATIONS 数组中的一个条目（version + up(db)）。
 * - 初始化时读取 metadata.schema_version（无则视为 0），顺序执行所有
 *   version 大于当前值的迁移，并在每步结束后更新 schema_version。
 * - v1 迁移即建立全部表 / 索引 / 虚拟表 / 触发器（幂等：均用 IF NOT EXISTS）。
 *
 * 注意：file_vectors / node_vectors / resource_vectors 依赖 sqlite-vec 扩展，
 * 因此迁移必须在扩展加载成功后执行（见 db.ts）。
 */
import type { Database } from "better-sqlite3";

/** 当前代码支持的最新 Schema 版本 */
export const CURRENT_SCHEMA_VERSION = 2;

/** 向量维度（BGE-M3 默认 1024） */
export const VECTOR_DIMENSIONS = 1024;

/** 一次 Schema 迁移 */
interface Migration {
  /** 目标版本号 */
  version: number;
  /** 迁移动作（在事务内执行） */
  up: (db: Database) => void;
}

/**
 * v1：建立全部基础表 / 索引 / 向量虚拟表 / FTS5 + 触发器 / 构建日志表。
 * 全部使用 IF NOT EXISTS，保证幂等。
 */
const V1_SQL = `
-- 元数据表
CREATE TABLE IF NOT EXISTS metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 文件表
CREATE TABLE IF NOT EXISTS files (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path       TEXT NOT NULL UNIQUE,
  language           TEXT,
  hash               TEXT NOT NULL,
  file_summary       TEXT,
  summary_status     TEXT DEFAULT 'pending',
  summary_model      TEXT,
  summary_prompt_ver TEXT,
  summary_updated_at TEXT,
  embedding_status   TEXT DEFAULT 'pending',
  embedding_model    TEXT,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_files_path ON files(file_path);
CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);

-- 节点表
CREATE TABLE IF NOT EXISTS nodes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id            INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  kind               TEXT NOT NULL,
  signature          TEXT,
  start_line         INTEGER,
  end_line           INTEGER,
  is_exported        INTEGER DEFAULT 0,
  summary            TEXT,
  summary_status     TEXT DEFAULT 'pending',
  summary_model      TEXT,
  summary_prompt_ver TEXT,
  summary_updated_at TEXT,
  source_code        TEXT,
  embedding_status   TEXT DEFAULT 'pending',
  embedding_model    TEXT,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_id);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_exported ON nodes(is_exported);

-- 边表
CREATE TABLE IF NOT EXISTS edges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target     INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source, target, kind)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);

-- 多模态资源表
CREATE TABLE IF NOT EXISTS resources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  source_path TEXT,
  name        TEXT NOT NULL,
  content     TEXT,
  summary     TEXT,
  hash        TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type);

-- 多模态边表
CREATE TABLE IF NOT EXISTS resource_edges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  similarity  REAL,
  confidence  REAL DEFAULT 1.0,
  link_type   TEXT DEFAULT 'strong',
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(resource_id, file_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_resource_edges_resource ON resource_edges(resource_id);
CREATE INDEX IF NOT EXISTS idx_resource_edges_file ON resource_edges(file_id);

-- 构建日志表
CREATE TABLE IF NOT EXISTS build_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  status      TEXT DEFAULT 'running',
  files_total INTEGER DEFAULT 0,
  files_done  INTEGER DEFAULT 0,
  commit_hash TEXT
);
`;

/** 向量虚拟表 DDL（依赖 sqlite-vec，维度插值） */
const V1_VECTOR_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS file_vectors USING vec0(
  file_id INTEGER PRIMARY KEY,
  embedding FLOAT[${VECTOR_DIMENSIONS}]
);
CREATE VIRTUAL TABLE IF NOT EXISTS node_vectors USING vec0(
  node_id INTEGER PRIMARY KEY,
  embedding FLOAT[${VECTOR_DIMENSIONS}]
);
CREATE VIRTUAL TABLE IF NOT EXISTS resource_vectors USING vec0(
  resource_id INTEGER PRIMARY KEY,
  embedding FLOAT[${VECTOR_DIMENSIONS}]
);
`;

/** FTS5 全文表 + 同步触发器 DDL
 *
 * tokenize='trigram'：使用 FTS5 内置 trigram（三元组）分词器。
 * - 默认 unicode61 分词器把 CJK 连续汉字整体当作一个 token，导致"溯源"无法
 *   匹配"查询交易溯源列表数据"，中文召回率极低。
 * - trigram 将文本切成长度为 3 的滑动子串（char 级），使任意 ≥3 字符（含 3 个
 *   汉字）的子串都能命中；英文标识符（如 getTradeOriginList）的子串匹配同样生效。
 * - 无额外依赖（SQLite 3.34+ 内置）。
 * - 局限：<3 字符的查询词无法通过 MATCH 命中，由 searchFts 的 LIKE 兜底补齐。
 */
const V1_FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  name,
  summary,
  content='nodes',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, name, summary) VALUES (new.id, new.name, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, name, summary) VALUES ('delete', old.id, old.name, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, name, summary) VALUES ('delete', old.id, old.name, old.summary);
  INSERT INTO nodes_fts(rowid, name, summary) VALUES (new.id, new.name, new.summary);
END;
`;

/**
 * v2：将 nodes_fts 从默认分词器迁移到 trigram 分词器（存量库重建）。
 *
 * 旧库的 nodes_fts 已用默认 unicode61 分词器建成，仅靠 IF NOT EXISTS 无法切换，
 * 故显式 DROP 后按新 DDL 重建，并从 content 表（nodes）rebuild 索引，
 *��发器沿用 V1_FTS_SQL 中的定义（DROP 后重新 CREATE）。
 */
const V2_FTS_TRIGRAM_SQL = `
DROP TRIGGER IF EXISTS nodes_ai;
DROP TRIGGER IF EXISTS nodes_ad;
DROP TRIGGER IF EXISTS nodes_au;
DROP TABLE IF EXISTS nodes_fts;
`;

/** 全部迁移，按 version 升序 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db: Database): void => {
      db.exec(V1_SQL);
      db.exec(V1_VECTOR_SQL);
      db.exec(V1_FTS_SQL);
      db.prepare(
        "INSERT OR IGNORE INTO metadata(key, value) VALUES ('created_at', datetime('now'))",
      ).run();
    },
  },
  {
    version: 2,
    up: (db: Database): void => {
      // 存量库：先拆除旧 nodes_fts 及其触发器
      db.exec(V2_FTS_TRIGRAM_SQL);
      // 按新 DDL（trigram）重建虚拟表与触发器
      db.exec(V1_FTS_SQL);
      // 从 content 表（nodes）重建 FTS 索引，回填历史数据
      db.exec("INSERT INTO nodes_fts(nodes_fts) VALUES ('rebuild')");
    },
  },
];

/** 读取当前 schema_version（未建表 / 无记录返回 0） */
export function getSchemaVersion(db: Database): number {
  const row = db
    .prepare(
      "SELECT value FROM metadata WHERE key = 'schema_version'",
    )
    .pluck()
    .get() as string | undefined;
  if (row === undefined) return 0;
  const n = Number.parseInt(row, 10);
  return Number.isNaN(n) ? 0 : n;
}

/** 写入 schema_version */
function setSchemaVersion(db: Database, version: number): void {
  db.prepare(
    "INSERT INTO metadata(key, value) VALUES ('schema_version', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(String(version));
}

/**
 * 执行迁移：顺序应用所有版本大于当前 schema_version 的迁移。
 * 幂等：重复调用（版本已最新）不做任何变更。
 *
 * @returns 迁移后的最终 schema 版本
 */
export function migrate(db: Database): number {
  // metadata 表可能尚未存在，先确保其存在以便读取版本
  db.exec(
    "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );

  let current = getSchemaVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version,
  );

  for (const m of pending) {
    const tx = db.transaction(() => {
      m.up(db);
      setSchemaVersion(db, m.version);
    });
    tx();
    current = m.version;
  }

  return current;
}