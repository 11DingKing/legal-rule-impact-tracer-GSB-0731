export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  effective_from TEXT
);

CREATE TABLE IF NOT EXISTS articles (
  stable_id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES versions(id),
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS article_references (
  article_id TEXT NOT NULL REFERENCES articles(stable_id) ON DELETE CASCADE,
  reference_id TEXT NOT NULL REFERENCES articles(stable_id),
  ordinal INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, reference_id)
);

CREATE TABLE IF NOT EXISTS succession_edges (
  from_id TEXT NOT NULL REFERENCES articles(stable_id),
  to_id TEXT NOT NULL REFERENCES articles(stable_id),
  kind TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (from_id, to_id, kind)
);

CREATE TABLE IF NOT EXISTS bindings (
  rule_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(stable_id),
  ordinal INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (rule_id, article_id)
);

CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source_version_id TEXT NOT NULL,
  target_version_id TEXT NOT NULL,
  queried_at TEXT NOT NULL,
  graph_fingerprint TEXT NOT NULL,
  report_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_articles_version ON articles(version_id);
CREATE INDEX IF NOT EXISTS idx_succession_from ON succession_edges(from_id);
CREATE INDEX IF NOT EXISTS idx_succession_to ON succession_edges(to_id);
CREATE INDEX IF NOT EXISTS idx_bindings_rule ON bindings(rule_id);
CREATE INDEX IF NOT EXISTS idx_bindings_article ON bindings(article_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at);
`;
