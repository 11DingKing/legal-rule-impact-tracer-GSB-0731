import { Injectable } from '@nestjs/common';
import type {
  ArticleInput,
  BindingInput,
  SuccessionInput,
  SuccessionKind,
  VersionInput,
  VersionStatus,
} from '../../domain';
import { makeArticleKey } from '../../domain';
import { DatabaseService } from './database.service';

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
}

interface SuccessionRow {
  from_stable_id: string;
  to_stable_id: string;
  kind: string;
}

interface BindingRow {
  rule_id: string;
  article_stable_id: string;
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
    const countBefore = (
      db.prepare(`SELECT COUNT(*) as c FROM versions`).get() as { c: number }
    ).c;
    const tx = db.transaction((rows: ReadonlyArray<VersionInput>) => {
      for (const v of rows) {
        insert.run(v.id, v.status, v.effectiveFrom, ordinals.get(v.id) ?? 0);
      }
    });
    tx(versions);
    const countAfter = (
      db.prepare(`SELECT COUNT(*) as c FROM versions`).get() as { c: number }
    ).c;
    const inserted = countAfter - countBefore;
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
    const countBefore = (
      db.prepare(`SELECT COUNT(*) as c FROM articles`).get() as { c: number }
    ).c;
    const tx = db.transaction((rows: ReadonlyArray<ArticleInput>) => {
      for (const a of rows) {
        const key = makeArticleKey(a.stableId, a.version);
        insert.run(a.stableId, a.version, a.label, key);
      }
    });
    tx(articles);
    const countAfter = (
      db.prepare(`SELECT COUNT(*) as c FROM articles`).get() as { c: number }
    ).c;
    const inserted = countAfter - countBefore;
    return { inserted, duplicates: articles.length - inserted };
  }

  importReferences(
    references: ReadonlyArray<{
      readonly fromKey: string;
      readonly toStableId: string;
    }>,
  ): { inserted: number; duplicates: number } {
    const db = this.dbService.getDb();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO article_references (from_key, to_stable_id)
       VALUES (?, ?)`,
    );
    const countBefore = (
      db.prepare(`SELECT COUNT(*) as c FROM article_references`).get() as {
        c: number;
      }
    ).c;
    const tx = db.transaction(
      (
        rows: ReadonlyArray<{
          readonly fromKey: string;
          readonly toStableId: string;
        }>,
      ) => {
        for (const r of rows) insert.run(r.fromKey, r.toStableId);
      },
    );
    tx(references);
    const countAfter = (
      db.prepare(`SELECT COUNT(*) as c FROM article_references`).get() as {
        c: number;
      }
    ).c;
    return {
      inserted: countAfter - countBefore,
      duplicates: references.length - (countAfter - countBefore),
    };
  }

  importSuccessions(
    successions: ReadonlyArray<SuccessionInput>,
  ): { inserted: number; duplicates: number } {
    const db = this.dbService.getDb();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO successions (from_stable_id, to_stable_id, kind)
       VALUES (?, ?, ?)`,
    );
    const countBefore = (
      db.prepare(`SELECT COUNT(*) as c FROM successions`).get() as { c: number }
    ).c;
    const totalPairs = { value: 0 };
    const tx = db.transaction((rows: ReadonlyArray<SuccessionInput>) => {
      for (const s of rows) {
        const fromList = Array.isArray(s.from) ? s.from : [s.from];
        const toList = Array.isArray(s.to) ? s.to : [s.to];
        for (const f of fromList) {
          for (const t of toList) {
            totalPairs.value++;
            insert.run(f, t, s.kind);
          }
        }
      }
    });
    tx(successions);
    const countAfter = (
      db.prepare(`SELECT COUNT(*) as c FROM successions`).get() as { c: number }
    ).c;
    const inserted = countAfter - countBefore;
    return { inserted, duplicates: totalPairs.value - inserted };
  }

  importBindings(
    bindings: ReadonlyArray<BindingInput>,
  ): { inserted: number; duplicates: number } {
    const db = this.dbService.getDb();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO bindings (rule_id, article_stable_id)
       VALUES (?, ?)`,
    );
    const countBefore = (
      db.prepare(`SELECT COUNT(*) as c FROM bindings`).get() as { c: number }
    ).c;
    const tx = db.transaction((rows: ReadonlyArray<BindingInput>) => {
      for (const b of rows) {
        for (const aid of b.articleIds) insert.run(b.ruleId, aid);
      }
    });
    tx(bindings);
    const countAfter = (
      db.prepare(`SELECT COUNT(*) as c FROM bindings`).get() as { c: number }
    ).c;
    const inserted = countAfter - countBefore;
    return { inserted, duplicates: 0 };
  }

  loadVersions(): ReadonlyArray<VersionInput> {
    const db = this.dbService.getDb();
    const rows = db
      .prepare(
        `SELECT id, status, effective_from, ordinal FROM versions ORDER BY ordinal, id`,
      )
      .all() as VersionRow[];
    return rows.map((r) => ({
      id: r.id,
      status: r.status as VersionStatus,
      effectiveFrom: r.effective_from,
    }));
  }

  loadArticles(): ReadonlyArray<ArticleInput> {
    const db = this.dbService.getDb();
    const rows = db
      .prepare(
        `SELECT stable_id, version_id, label, article_key FROM articles ORDER BY article_key`,
      )
      .all() as ArticleRow[];
    const refsByFrom = new Map<string, string[]>();
    for (const r of this.loadReferences()) {
      const list = refsByFrom.get(r.from_key);
      if (list) list.push(r.to_stable_id);
      else refsByFrom.set(r.from_key, [r.to_stable_id]);
    }
    return rows.map((r) => {
      const refs = refsByFrom.get(r.article_key);
      const out: ArticleInput = {
        stableId: r.stable_id,
        version: r.version_id,
        label: r.label,
      };
      if (refs && refs.length > 0) out.references = Object.freeze([...refs].sort());
      return out;
    });
  }

  loadReferences(): ReadonlyArray<ReferenceRow> {
    const db = this.dbService.getDb();
    return db
      .prepare(
        `SELECT from_key, to_stable_id FROM article_references ORDER BY from_key, to_stable_id`,
      )
      .all() as ReferenceRow[];
  }

  loadSuccessions(): ReadonlyArray<SuccessionInput> {
    const db = this.dbService.getDb();
    const rows = db
      .prepare(
        `SELECT from_stable_id, to_stable_id, kind FROM successions ORDER BY from_stable_id, to_stable_id, kind`,
      )
      .all() as SuccessionRow[];
    const grouped = new Map<
      string,
      { kind: SuccessionKind; from: Set<string>; to: Set<string> }
    >();
    for (const r of rows) {
      const key = `${r.kind}`;
      let entry = grouped.get(key);
      if (!entry) {
        entry = {
          kind: r.kind as SuccessionKind,
          from: new Set<string>(),
          to: new Set<string>(),
        };
        grouped.set(key, entry);
      }
      entry.from.add(r.from_stable_id);
      entry.to.add(r.to_stable_id);
    }
    return [...grouped.values()].map((g) => ({
      from: Object.freeze([...g.from].sort()),
      to: Object.freeze([...g.to].sort()),
      kind: g.kind,
    }));
  }

  loadBindings(): ReadonlyArray<BindingInput> {
    const db = this.dbService.getDb();
    const rows = db
      .prepare(
        `SELECT rule_id, article_stable_id FROM bindings ORDER BY rule_id, article_stable_id`,
      )
      .all() as BindingRow[];
    const byRule = new Map<string, string[]>();
    for (const r of rows) {
      const list = byRule.get(r.rule_id);
      if (list) list.push(r.article_stable_id);
      else byRule.set(r.rule_id, [r.article_stable_id]);
    }
    return [...byRule.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([ruleId, ids]) => ({
        ruleId,
        articleIds: Object.freeze(ids),
      }));
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
    return db.prepare(`SELECT * FROM snapshots WHERE id = ?`).get(id) as
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
