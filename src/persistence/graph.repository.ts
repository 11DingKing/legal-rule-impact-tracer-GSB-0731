import { Injectable } from "@nestjs/common";
import type {
  Article,
  LawVersion,
  ReferenceEdge,
  RevisionGraph,
  RuleBinding,
  SuccessionEdge,
  VersionStatus,
} from "../domain/types";
import { DatabaseService } from "./database.service";

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
  version_id: string;
  from_id: string;
  to_id: string;
}

interface SuccessionRow {
  from_id: string;
  to_id: string;
  kind: string;
}

interface BindingRow {
  rule_id: string;
  article_id: string;
}

/**
 * Reads and writes the imported graph. Contains no propagation logic:
 * it only moves rows between SQLite and the domain RevisionGraph shape.
 */
@Injectable()
export class GraphRepository {
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
       ON CONFLICT (version_id, from_id, to_id) DO UPDATE SET to_id = excluded.to_id`,
    );
    const upsertSuccession = db.prepare(
      `INSERT INTO succession_edges (from_id, to_id, kind)
       VALUES (?, ?, ?)
       ON CONFLICT (from_id, to_id) DO UPDATE SET kind = excluded.kind`,
    );
    const insertBinding = db.prepare(
      `INSERT INTO rule_bindings (rule_id, article_id)
       VALUES (?, ?)
       ON CONFLICT (rule_id, article_id) DO UPDATE SET article_id = excluded.article_id`,
    );

    this.database.transaction(() => {
      for (const version of graph.versions) {
        upsertVersion.run(version.id, version.status, version.effectiveFrom);
      }
      for (const article of graph.articles) {
        upsertArticle.run(article.stableId, article.versionId, article.label);
      }
      for (const reference of graph.references) {
        insertReference.run(
          reference.versionId,
          reference.fromId,
          reference.toId,
        );
      }
      for (const edge of graph.succession) {
        upsertSuccession.run(edge.fromId, edge.toId, edge.kind);
      }
      for (const binding of graph.bindings) {
        insertBinding.run(binding.ruleId, binding.articleId);
      }
    });
  }

  loadGraph(): RevisionGraph {
    const db = this.database.connection();

    const versions = db
      .prepare(
        "SELECT id, status, effective_from FROM law_versions ORDER BY id",
      )
      .all() as unknown as VersionRow[];
    const articles = db
      .prepare(
        "SELECT stable_id, version_id, label FROM articles ORDER BY stable_id, version_id",
      )
      .all() as unknown as ArticleRow[];
    const references = db
      .prepare(
        "SELECT version_id, from_id, to_id FROM article_references ORDER BY version_id, from_id, to_id",
      )
      .all() as unknown as ReferenceRow[];
    const succession = db
      .prepare(
        "SELECT from_id, to_id, kind FROM succession_edges ORDER BY from_id, to_id",
      )
      .all() as unknown as SuccessionRow[];
    const bindings = db
      .prepare(
        "SELECT rule_id, article_id FROM rule_bindings ORDER BY rule_id, article_id",
      )
      .all() as unknown as BindingRow[];

    return {
      versions: versions.map(
        (row): LawVersion => ({
          id: row.id,
          status: row.status as VersionStatus,
          effectiveFrom: row.effective_from,
        }),
      ),
      articles: articles.map(
        (row): Article => ({
          stableId: row.stable_id,
          versionId: row.version_id,
          label: row.label,
        }),
      ),
      references: references.map(
        (row): ReferenceEdge => ({
          versionId: row.version_id,
          fromId: row.from_id,
          toId: row.to_id,
        }),
      ),
      succession: succession.map(
        (row): SuccessionEdge => ({
          fromId: row.from_id,
          toId: row.to_id,
          kind: row.kind as SuccessionEdge["kind"],
        }),
      ),
      bindings: bindings.map(
        (row): RuleBinding => ({
          ruleId: row.rule_id,
          articleId: row.article_id,
        }),
      ),
    };
  }
}
