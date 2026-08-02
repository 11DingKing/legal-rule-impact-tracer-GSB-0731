import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

export const DATABASE_PATH_ENV = 'DATABASE_PATH';

/**
 * Schema for the tracer. Note the snapshots table is append-only by contract:
 * no UPDATE or DELETE statement targets it anywhere in the codebase, which is
 * what makes a stored snapshot an immutable record. It freezes the query, the
 * whole graph, and the computed result, so later edits to edges or labels can
 * never make an old snapshot replay differently.
 */
const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS law_versions (
  id             TEXT PRIMARY KEY,
  status         TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'EFFECTIVE')),
  effective_from TEXT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  stable_id  TEXT NOT NULL,
  version_id TEXT NOT NULL REFERENCES law_versions(id),
  label      TEXT NOT NULL,
  PRIMARY KEY (stable_id, version_id)
);

CREATE TABLE IF NOT EXISTS article_references (
  version_id TEXT NOT NULL,
  from_id    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  PRIMARY KEY (version_id, from_id, to_id)
);

CREATE TABLE IF NOT EXISTS succession_edges (
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('RENUMBER', 'SPLIT', 'MERGE')),
  PRIMARY KEY (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS rule_bindings (
  rule_id    TEXT NOT NULL,
  article_id TEXT NOT NULL,
  PRIMARY KEY (rule_id, article_id)
);

CREATE TABLE IF NOT EXISTS import_batches (
  id           TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE,
  imported_at  TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

-- Snapshots are append-only: no UPDATE or DELETE statement exists for this
-- table anywhere in the codebase. Replay reads the frozen graph and result.
CREATE TABLE IF NOT EXISTS snapshots (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  query_json  TEXT NOT NULL,
  graph_json  TEXT NOT NULL,
  result_json TEXT NOT NULL,
  graph_hash  TEXT NOT NULL DEFAULT ''
);
`;

/**
 * Owns the single SQLite connection and exposes a small transaction helper.
 * This is the only place that talks to `node:sqlite`; nothing here knows about
 * impact rules.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private db: DatabaseSync | null = null;

  onModuleInit(): void {
    const databasePath = process.env[DATABASE_PATH_ENV] ?? 'data/legal-tracer.db';
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    }
    this.db = new DatabaseSync(databasePath);
    this.db.exec(SCHEMA_SQL);
  }

  onModuleDestroy(): void {
    this.db?.close();
    this.db = null;
  }

  connection(): DatabaseSync {
    if (this.db === null) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  transaction<T>(work: () => T): T {
    const db = this.connection();
    db.exec('BEGIN');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
