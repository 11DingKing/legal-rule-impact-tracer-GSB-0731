import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { SUCCESSION_KINDS, VERSION_STATUSES } from '../domain/types';
import type {
  RevisionGraph,
  SuccessionKind,
  VersionStatus,
} from '../domain/types';

type Row = Record<string, unknown>;

/** Narrow an unknown SQLite cell to a required string. */
function asString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected string column, received ${typeof value}`);
  }
  return value;
}

/** Narrow an unknown SQLite cell to a string or null. */
function asStringOrNull(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return asString(value);
}

function asVersionStatus(value: unknown): VersionStatus {
  const text = asString(value);
  const match = VERSION_STATUSES.find((status) => status === text);
  if (match === undefined) {
    throw new Error(`Unknown version status persisted: ${text}`);
  }
  return match;
}

function asSuccessionKind(value: unknown): SuccessionKind {
  const text = asString(value);
  const match = SUCCESSION_KINDS.find((kind) => kind === text);
  if (match === undefined) {
    throw new Error(`Unknown succession kind persisted: ${text}`);
  }
  return match;
}

/**
 * Persists imported graphs and reloads them in a stable, sorted shape.
 *
 * Upserts are idempotent on their primary keys, so re-importing the same rows
 * (whole or partial) never duplicates them. This adapter contains no impact
 * logic — it only reads and writes rows.
 */
@Injectable()
export class GraphRepository {
  private cachedGraph: RevisionGraph | null = null;

  constructor(private readonly database: DatabaseService) {}

  upsertGraph(graph: RevisionGraph): void {
    const db = this.database.connection();
    const upsertVersion = db.prepare(
      `INSERT INTO law_versions (id, status, effective_from)
       VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         status = excluded.status,
         effective_from = excluded.effective_from`,
    );
    const upsertArticle = db.prepare(
      `INSERT INTO articles (stable_id, version_id, label)
       VALUES (?, ?, ?)
       ON CONFLICT (stable_id, version_id) DO UPDATE SET label = excluded.label`,
    );
    const insertReference = db.prepare(
      `INSERT INTO article_references (version_id, from_id, to_id)
       VALUES (?, ?, ?)
       ON CONFLICT (version_id, from_id, to_id) DO NOTHING`,
    );
    const upsertSuccession = db.prepare(
      `INSERT INTO succession_edges (from_id, to_id, kind)
       VALUES (?, ?, ?)
       ON CONFLICT (from_id, to_id) DO UPDATE SET kind = excluded.kind`,
    );
    const insertBinding = db.prepare(
      `INSERT INTO rule_bindings (rule_id, article_id)
       VALUES (?, ?)
       ON CONFLICT (rule_id, article_id) DO NOTHING`,
    );

    this.database.transaction(() => {
      for (const version of graph.versions) {
        upsertVersion.run(version.id, version.status, version.effectiveFrom);
      }
      for (const article of graph.articles) {
        upsertArticle.run(article.stableId, article.versionId, article.label);
      }
      for (const reference of graph.references) {
        insertReference.run(reference.versionId, reference.fromId, reference.toId);
      }
      for (const edge of graph.succession) {
        upsertSuccession.run(edge.fromId, edge.toId, edge.kind);
      }
      for (const binding of graph.bindings) {
        insertBinding.run(binding.ruleId, binding.articleId);
      }
    });

    this.cachedGraph = null;
  }

  loadGraph(): RevisionGraph {
    if (this.cachedGraph !== null) {
      return this.cachedGraph;
    }
    const db = this.database.connection();
    const versions = db
      .prepare('SELECT id, status, effective_from FROM law_versions ORDER BY id')
      .all() as Row[];
    const articles = db
      .prepare(
        'SELECT stable_id, version_id, label FROM articles ORDER BY stable_id, version_id',
      )
      .all() as Row[];
    const references = db
      .prepare(
        'SELECT version_id, from_id, to_id FROM article_references ORDER BY version_id, from_id, to_id',
      )
      .all() as Row[];
    const succession = db
      .prepare(
        'SELECT from_id, to_id, kind FROM succession_edges ORDER BY from_id, to_id',
      )
      .all() as Row[];
    const bindings = db
      .prepare(
        'SELECT rule_id, article_id FROM rule_bindings ORDER BY rule_id, article_id',
      )
      .all() as Row[];

    const graph: RevisionGraph = {
      versions: versions.map((row) => ({
        id: asString(row['id']),
        status: asVersionStatus(row['status']),
        effectiveFrom: asStringOrNull(row['effective_from']),
      })),
      articles: articles.map((row) => ({
        stableId: asString(row['stable_id']),
        versionId: asString(row['version_id']),
        label: asString(row['label']),
      })),
      references: references.map((row) => ({
        versionId: asString(row['version_id']),
        fromId: asString(row['from_id']),
        toId: asString(row['to_id']),
      })),
      succession: succession.map((row) => ({
        fromId: asString(row['from_id']),
        toId: asString(row['to_id']),
        kind: asSuccessionKind(row['kind']),
      })),
      bindings: bindings.map((row) => ({
        ruleId: asString(row['rule_id']),
        articleId: asString(row['article_id']),
      })),
    };
    this.cachedGraph = graph;
    return graph;
  }
}
