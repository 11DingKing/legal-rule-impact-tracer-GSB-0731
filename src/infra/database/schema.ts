export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','EFFECTIVE')),
  effective_from TEXT,
  ordinal INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS articles (
  stable_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  label TEXT NOT NULL,
  article_key TEXT NOT NULL,
  PRIMARY KEY (article_key),
  FOREIGN KEY (version_id) REFERENCES versions(id)
);

CREATE INDEX IF NOT EXISTS idx_articles_stable ON articles(stable_id);
CREATE INDEX IF NOT EXISTS idx_articles_version ON articles(version_id);

CREATE TABLE IF NOT EXISTS article_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_key TEXT NOT NULL,
  to_stable_id TEXT NOT NULL,
  UNIQUE(from_key, to_stable_id),
  FOREIGN KEY (from_key) REFERENCES articles(article_key)
);

CREATE TABLE IF NOT EXISTS successions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_stable_id TEXT NOT NULL,
  to_stable_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('SPLIT','MERGE','RENUMBER','REPLACE')),
  UNIQUE(from_stable_id, to_stable_id, kind)
);

CREATE TABLE IF NOT EXISTS bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL,
  article_stable_id TEXT NOT NULL,
  UNIQUE(rule_id, article_stable_id)
);

CREATE INDEX IF NOT EXISTS idx_bindings_rule ON bindings(rule_id);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  query_json TEXT NOT NULL,
  graph_hash TEXT NOT NULL,
  frozen_versions_json TEXT NOT NULL,
  frozen_articles_json TEXT NOT NULL,
  frozen_edges_json TEXT NOT NULL,
  frozen_rules_json TEXT NOT NULL,
  result_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at);
`;
