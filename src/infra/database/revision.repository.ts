import { Injectable } from '@nestjs/common';
import type {
  ArticleInput,
  BindingInput,
  SuccessionInput,
  VersionInput,
} from '../../domain';
import { DatabaseService } from './database.service';
import { makeArticleKey } from '../../domain';

interface VersionRow {
  id: string;
  status: string;
  effective_from: string | null;
  ordinal: number;
}

interface ArticleRow {
  stable_id: string;
  version_id: string;
  label: string;
  article_key: string;
}

interface ReferenceRow {
  from_key: string;
  to_stable_id: string;
  to_key: string | null;
  resolved: number;
}

interface SuccessionRow {
  from_key: string;
  to_key: string;
  kind: string;
  from_stable_id: string;
  to_stable_id: string;
}

interface BindingRow {
  rule_id: string;
  article_key: string;
}

@Injectable()
export class RevisionRepository {
  constructor(private readonly dbService: DatabaseService) {}

  importVersions(
    versions: ReadonlyArray<VersionInput>,
    ordinals: ReadonlyMap<string, number>,
  ): { inserted: number; duplicates: number } {
    const db = this.dbService.getDb();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO versions (id, status, effective_from, ordinal)
       VALUES (?, ?, ?, ?)`,
    );
    const countBefore = db
      .prepare(`SELECT COUNT(*) as c FROM versions`)
      .get() as { c: number };
    const tx = db.transaction((rows: ReadonlyArray<VersionInput>) => {
      for (const v of rows) {
        insert.run(v.id, v.status, v.effectiveFrom, ordinals.get(v.id) ?? 0);
      }
    });
    tx(versions);
    const countAfter = db
      .prepare(`SELECT COUNT(*) as c FROM versions`)
      .get() as { c: number };
    const inserted = countAfter.c - countBefore.c;
    return { inserted, duplicates: versions.length - inserted };
  }

  importArticles(
    articles: ReadonlyArray<ArticleInput>,
  ): { inserted: number; duplicates: number } {
    const db = this.dbService.getDb();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO articles (stable_id, version_id, label, article_key)
       VALUES (?, ?, ?, ?)`,
    );
    const countBefore = db
      .prepare(`SELECT COUNT(*) as c FROM articles`)
      .get() as { c: number };
    const tx = db.transaction((rows: ReadonlyArray<ArticleInput>) => {
      for (const a of rows) {
        const key = makeArticleKey(a.stableId, a.version);
        insert.run(a.stableId, a.version, a.label, key);
      }
    });
    tx(articles);
    const countAfter = db
      .prepare(`SELECT COUNT(*) as c FROM articles`)
      .get() as { c: number };
    const inserted = countAfter.c - countBefore.c;
    return { inserted, duplicates: articles.length - inserted };
  }

  importReferences(
    references: ReadonlyArray<{
      readonly fromKey: string;
      readonly toStableId: string;
    }>,
  ): { inserted: number; duplicates: number; unresolved: number } {
    const db = this.dbService.getDb();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO article_references (from_key, to_stable_id, to_key, resolved)
       VALUES (?, ?, ?, ?)`,
    );
    let unresolved = 0;
    const tx = db.transaction(
      (
        rows: ReadonlyArray<{
          readonly fromKey: string;
          readonly toStableId: string;
        }>,
      ) => {
        for (const r of rows) {
          const target = db
            .prepare(
              `SELECT article_key FROM articles WHERE stable_id = ? ORDER BY version_id DESC LIMIT 1`,
            )
            .get(r.toStableId) as { article_key: string } | undefined;
          if (!target) unresolved++;
          insert.run(r.fromKey, r.toStableId, target?.article_key ?? null, target ? 1 : 0);
        }
      },
    );
    tx(references);
    return { inserted: references.length - unresolved, duplicates: 0, unresolved };
  }

  importSuccessions(
    successions: ReadonlyArray<SuccessionInput>,
  ): { inserted: number; duplicates: number; unresolved: ReadonlyArray<string> } {
    const db = this.dbService.getDb();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO successions (from_key, to_key, kind, from_stable_id, to_stable_id)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const unresolved: string[] = [];
    const tx = db.transaction((rows: ReadonlyArray<SuccessionInput>) => {
      for (const s of rows) {
        const fromList = Array.isArray(s.from) ? s.from : [s.from];
        const toList = Array.isArray(s.to) ? s.to : [s.to];
        for (const f of fromList) {
          for (const t of toList) {
            const fRow = db
              .prepare(
                `SELECT article_key FROM articles WHERE stable_id = ? ORDER BY version_id DESC LIMIT 1`,
              )
              .get(f) as { article_key: string } | undefined;
            const tRow = db
              .prepare(
                `SELECT article_key FROM articles WHERE stable_id = ? ORDER BY version_id DESC LIMIT 1`,
              )
              .get(t) as { article_key: string } | undefined;
            if (!fRow || !tRow) {
              const missing: string[] = [];
              if (!fRow) missing.push(f);
              if (!tRow) missing.push(t);
              unresolved.push(...missing);
              continue;
            }
            insert.run(fRow.article_key, tRow.article_key, s.kind, f, t);
          }
        }
      }
    });
    tx(successions);
    return { inserted: 0, duplicates: 0, unresolved: Object.freeze(unresolved) };
  }

  importBindings(
    bindings: ReadonlyArray<BindingInput>,
  ): { inserted: number; duplicates: number } {
    const db = this.dbService.getDb();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO bindings (rule_id, article_key)
       SELECT ?, article_key FROM articles WHERE stable_id = ?
       ORDER BY version_id DESC LIMIT 1`,
    );
    let inserted = 0;
    const countStmt = db.prepare(`SELECT changes() as c`);
    const tx = db.transaction((rows: ReadonlyArray<BindingInput>) => {
      for (const b of rows) {
        for (const aid of b.articleIds) {
          insert.run(b.ruleId, aid);
          const r = countStmt.get() as { c: number };
          inserted += r.c;
        }
      }
    });
    tx(bindings);
    return { inserted, duplicates: 0 };
  }

  loadAllVersions(): ReadonlyArray<VersionRow> {
    const db = this.dbService.getDb();
    return db
      .prepare(`SELECT id, status, effective_from, ordinal FROM versions ORDER BY ordinal, id`)
      .all() as VersionRow[];
  }

  loadAllArticles(): ReadonlyArray<ArticleRow> {
    const db = this.dbService.getDb();
    return db
      .prepare(
        `SELECT stable_id, version_id, label, article_key FROM articles ORDER BY article_key`,
      )
      .all() as ArticleRow[];
  }

  loadAllReferences(): ReadonlyArray<ReferenceRow> {
    const db = this.dbService.getDb();
    return db
      .prepare(
        `SELECT from_key, to_stable_id, to_key, resolved FROM article_references`,
      )
      .all() as ReferenceRow[];
  }

  loadAllSuccessions(): ReadonlyArray<SuccessionRow> {
    const db = this.dbService.getDb();
    return db
      .prepare(
        `SELECT from_key, to_key, kind, from_stable_id, to_stable_id FROM successions`,
      )
      .all() as SuccessionRow[];
  }

  loadAllBindings(): ReadonlyArray<BindingRow> {
    const db = this.dbService.getDb();
    return db
      .prepare(`SELECT rule_id, article_key FROM bindings ORDER BY rule_id, article_key`)
      .all() as BindingRow[];
  }

  saveSnapshot(
    id: string,
    createdAt: string,
    queryJson: string,
    graphHash: string,
    versionsJson: string,
    articlesJson: string,
    edgesJson: string,
    rulesJson: string,
    resultJson: string,
  ): void {
    const db = this.dbService.getDb();
    db.prepare(
      `INSERT INTO snapshots
       (id, created_at, query_json, graph_hash, frozen_versions_json,
        frozen_articles_json, frozen_edges_json, frozen_rules_json, result_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      createdAt,
      queryJson,
      graphHash,
      versionsJson,
      articlesJson,
      edgesJson,
      rulesJson,
      resultJson,
    );
  }

  loadSnapshot(id: string):
    | {
        readonly id: string;
        readonly created_at: string;
        readonly query_json: string;
        readonly graph_hash: string;
        readonly frozen_versions_json: string;
        readonly frozen_articles_json: string;
        readonly frozen_edges_json: string;
        readonly frozen_rules_json: string;
        readonly result_json: string;
      }
    | undefined {
    const db = this.dbService.getDb();
    return db
      .prepare(`SELECT * FROM snapshots WHERE id = ?`)
      .get(id) as
      | {
          readonly id: string;
          readonly created_at: string;
          readonly query_json: string;
          readonly graph_hash: string;
          readonly frozen_versions_json: string;
          readonly frozen_articles_json: string;
          readonly frozen_edges_json: string;
          readonly frozen_rules_json: string;
          readonly result_json: string;
        }
      | undefined;
  }

  listSnapshots(): ReadonlyArray<{
    readonly id: string;
    readonly created_at: string;
    readonly graph_hash: string;
  }> {
    const db = this.dbService.getDb();
    return db
      .prepare(
        `SELECT id, created_at, graph_hash FROM snapshots ORDER BY created_at DESC, id`,
      )
      .all() as { id: string; created_at: string; graph_hash: string }[];
  }
}
