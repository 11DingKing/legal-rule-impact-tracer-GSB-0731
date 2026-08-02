import { Injectable } from '@nestjs/common';
import type { Database as DatabaseType } from 'better-sqlite3';
import { SqliteService } from '../sqlite/sqlite.service';
import {
  ArticleStableId,
  RegulationVersionId,
  RuleId,
  SuccessionKind,
  VersionStatus,
  RevisionGraphInput,
  VersionInput,
  ArticleInput,
  SuccessionInput,
  BindingInput,
} from '../../../domain';

interface VersionRow {
  id: string;
  status: string;
  effective_from: string | null;
}

interface ArticleRow {
  stable_id: string;
  version_id: string;
  label: string;
}

interface ReferenceRow {
  article_id: string;
  reference_id: string;
  ordinal: number;
}

interface SuccessionRow {
  from_id: string;
  to_id: string;
  kind: string;
  ordinal: number;
}

interface BindingRow {
  rule_id: string;
  article_id: string;
  ordinal: number;
}

@Injectable()
export class GraphRepository {
  constructor(private readonly sqlite: SqliteService) {}

  importData(input: RevisionGraphInput): {
    versionsImported: number;
    articlesImported: number;
    successionsImported: number;
    bindingsImported: number;
  } {
    const db = this.sqlite.getDb();
    const versionsImported = this.importVersions(db, input.versions);
    const articlesImported = this.importArticles(db, input.articles);
    const successionsImported = this.importSuccessions(
      db,
      input.succession,
    );
    const bindingsImported = this.importBindings(db, input.bindings);

    return {
      versionsImported,
      articlesImported,
      successionsImported,
      bindingsImported,
    };
  }

  private importVersions(
    db: DatabaseType,
    versions: VersionInput[],
  ): number {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO versions (id, status, effective_from)
       VALUES (?, ?, ?)`,
    );
    let count = 0;
    for (const v of versions) {
      const info = stmt.run(v.id, v.status, v.effectiveFrom);
      if (info.changes > 0) count++;
    }
    return count;
  }

  private importArticles(
    db: DatabaseType,
    articles: ArticleInput[],
  ): number {
    const insertArticle = db.prepare(
      `INSERT OR IGNORE INTO articles (stable_id, version_id, label)
       VALUES (?, ?, ?)`,
    );
    const insertRef = db.prepare(
      `INSERT OR IGNORE INTO article_references (article_id, reference_id, ordinal)
       VALUES (?, ?, ?)`,
    );
    let count = 0;
    for (const a of articles) {
      const info = insertArticle.run(a.stableId, a.version, a.label);
      if (info.changes > 0) count++;
    }
    for (const a of articles) {
      const refs = a.references ?? [];
      refs.forEach((refId, idx) => {
        insertRef.run(a.stableId, refId, idx);
      });
    }
    return count;
  }

  private importSuccessions(
    db: DatabaseType,
    successions: SuccessionInput[],
  ): number {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO succession_edges (from_id, to_id, kind, ordinal)
       VALUES (?, ?, ?, ?)`,
    );
    let count = 0;
    for (const s of successions) {
      s.to.forEach((toId, idx) => {
        const info = stmt.run(s.from, toId, s.kind, idx);
        if (info.changes > 0) count++;
      });
    }
    return count;
  }

  private importBindings(
    db: DatabaseType,
    bindings: BindingInput[],
  ): number {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO bindings (rule_id, article_id, ordinal)
       VALUES (?, ?, ?)`,
    );
    let count = 0;
    for (const b of bindings) {
      b.articleIds.forEach((artId, idx) => {
        const info = stmt.run(b.ruleId, artId, idx);
        if (info.changes > 0) count++;
      });
    }
    return count;
  }

  loadGraphData(): RevisionGraphInput {
    const db = this.sqlite.getDb();

    const versionRows = db
      .prepare(`SELECT id, status, effective_from FROM versions ORDER BY id`)
      .all() as VersionRow[];

    const articleRows = db
      .prepare(
        `SELECT stable_id, version_id, label FROM articles ORDER BY stable_id`,
      )
      .all() as ArticleRow[];

    const refRows = db
      .prepare(
        `SELECT article_id, reference_id, ordinal
         FROM article_references
         ORDER BY article_id, ordinal`,
      )
      .all() as ReferenceRow[];

    const successionRows = db
      .prepare(
        `SELECT from_id, to_id, kind, ordinal
         FROM succession_edges
         ORDER BY from_id, ordinal`,
      )
      .all() as SuccessionRow[];

    const bindingRows = db
      .prepare(
        `SELECT rule_id, article_id, ordinal
         FROM bindings
         ORDER BY rule_id, ordinal`,
      )
      .all() as BindingRow[];

    const versions: VersionInput[] = versionRows.map((r) => ({
      id: r.id as RegulationVersionId,
      status: r.status as VersionStatus,
      effectiveFrom: r.effective_from,
    }));

    const refsByArticle = new Map<string, string[]>();
    for (const r of refRows) {
      const arr = refsByArticle.get(r.article_id);
      if (arr) {
        arr.push(r.reference_id);
      } else {
        refsByArticle.set(r.article_id, [r.reference_id]);
      }
    }

    const articles: ArticleInput[] = articleRows.map((r) => ({
      stableId: r.stable_id as ArticleStableId,
      version: r.version_id as RegulationVersionId,
      label: r.label,
      references: [
        ...new Set(refsByArticle.get(r.stable_id) ?? []),
      ]
        .sort()
        .map((ref) => ref as ArticleStableId),
    }));

    const successionMap = new Map<
      string,
      { from: string; to: string[]; kind: string }
    >();
    for (const r of successionRows) {
      const key = `${r.from_id}|${r.kind}`;
      const existing = successionMap.get(key);
      if (existing) {
        existing.to.push(r.to_id);
      } else {
        successionMap.set(key, {
          from: r.from_id,
          to: [r.to_id],
          kind: r.kind,
        });
      }
    }
    const succession: SuccessionInput[] = [...successionMap.values()]
      .map((val) => ({
        from: val.from as ArticleStableId,
        to: [...new Set(val.to)]
          .sort()
          .map((t) => t as ArticleStableId),
        kind: val.kind as SuccessionKind,
      }))
      .sort((a, b) => a.from.localeCompare(b.from));

    const bindingsMap = new Map<string, Set<string>>();
    for (const r of bindingRows) {
      const set = bindingsMap.get(r.rule_id);
      if (set) {
        set.add(r.article_id);
      } else {
        bindingsMap.set(r.rule_id, new Set([r.article_id]));
      }
    }
    const bindings: BindingInput[] = [...bindingsMap.entries()]
      .map(([ruleId, artIds]) => ({
        ruleId: ruleId as RuleId,
        articleIds: [...artIds]
          .sort()
          .map((a) => a as ArticleStableId),
      }))
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId));

    return { versions, articles, succession, bindings };
  }

  clearAll(): void {
    const db = this.sqlite.getDb();
    db.exec(`
      DELETE FROM bindings;
      DELETE FROM succession_edges;
      DELETE FROM article_references;
      DELETE FROM articles;
      DELETE FROM versions;
    `);
  }
}
