import { Article } from '../models/article';
import { BusinessRuleBinding } from '../models/business-rule-binding';
import {
  ArticleStableId,
  RegulationVersionId,
} from '../models/branded-types';
import { RegulationVersion } from '../models/regulation-version';
import { RevisionGraph } from '../models/revision-graph';
import { SuccessionEdge } from '../models/succession-edge';
import {
  ReferentialIntegrityError,
  ValidationError,
} from '../errors/domain-errors';
import {
  RevisionGraphInput,
  VersionInput,
  ArticleInput,
  SuccessionInput,
  BindingInput,
} from '../ports/graph-input';

export class GraphBuilder {
  build(input: RevisionGraphInput): RevisionGraph {
    const versions = this.buildVersions(input.versions);
    const articles = this.buildArticles(input.articles, versions);
    const successionEdges = this.buildSuccessions(
      input.succession,
      articles,
    );
    const bindings = this.buildBindings(input.bindings, articles);

    this.validateCrossReferences(articles);
    this.validateSuccessionIntegrity(successionEdges, articles);

    return new RevisionGraph(
      versions,
      articles,
      successionEdges,
      bindings,
    );
  }

  private buildVersions(inputs: VersionInput[]): RegulationVersion[] {
    const seen = new Set<RegulationVersionId>();
    const versions: RegulationVersion[] = [];
    for (const v of inputs) {
      if (!v.id || v.id.length === 0) {
        throw new ValidationError('Version id must not be empty');
      }
      if (seen.has(v.id)) {
        continue;
      }
      seen.add(v.id);
      if (
        v.effectiveFrom !== null &&
        !/^\d{4}-\d{2}-\d{2}$/.test(v.effectiveFrom)
      ) {
        throw new ValidationError(
          `Invalid effectiveFrom date for version ${v.id}: ${v.effectiveFrom}`,
        );
      }
      versions.push({
        id: v.id,
        status: v.status,
        effectiveFrom: v.effectiveFrom,
      });
    }
    return versions;
  }

  private buildArticles(
    inputs: ArticleInput[],
    versions: readonly RegulationVersion[],
  ): Article[] {
    const versionIds = new Set(versions.map((v) => v.id));
    const seen = new Set<ArticleStableId>();
    const articles: Article[] = [];
    for (const a of inputs) {
      if (!a.stableId || a.stableId.length === 0) {
        throw new ValidationError('Article stableId must not be empty');
      }
      if (seen.has(a.stableId)) {
        continue;
      }
      seen.add(a.stableId);
      if (!versionIds.has(a.version)) {
        throw new ReferentialIntegrityError(
          `Article ${a.stableId} references unknown version ${a.version}`,
        );
      }
      const references = [...new Set(a.references ?? [])].sort((x, y) =>
        x.localeCompare(y),
      );
      articles.push({
        stableId: a.stableId,
        versionId: a.version,
        label: a.label,
        references,
      });
    }
    return articles;
  }

  private buildSuccessions(
    inputs: SuccessionInput[],
    articles: readonly Article[],
  ): SuccessionEdge[] {
    const articleIds = new Set(articles.map((a) => a.stableId));
    const edgeKeys = new Set<string>();
    const edges: SuccessionEdge[] = [];

    for (const s of inputs) {
      const key = `${s.from}->${[...s.to].sort().join(',')}(${s.kind})`;
      if (edgeKeys.has(key)) {
        continue;
      }
      edgeKeys.add(key);

      if (!articleIds.has(s.from)) {
        throw new ReferentialIntegrityError(
          `Succession edge from unknown article: ${s.from}`,
        );
      }
      if (s.to.length === 0) {
        throw new ValidationError(
          `Succession edge from ${s.from} must have at least one target`,
        );
      }
      for (const toId of s.to) {
        if (!articleIds.has(toId)) {
          throw new ReferentialIntegrityError(
            `Succession edge to unknown article: ${toId}`,
          );
        }
      }
      const uniqueTo = [...new Set(s.to)].sort((x, y) =>
        x.localeCompare(y),
      );
      edges.push({
        fromStableId: s.from,
        toStableIds: uniqueTo,
        kind: s.kind,
      });
    }
    return edges;
  }

  private buildBindings(
    inputs: BindingInput[],
    articles: readonly Article[],
  ): BusinessRuleBinding[] {
    const articleIds = new Set(articles.map((a) => a.stableId));
    const seen = new Set<string>();
    const bindings: BusinessRuleBinding[] = [];

    for (const b of inputs) {
      if (!b.ruleId || b.ruleId.length === 0) {
        throw new ValidationError('Binding ruleId must not be empty');
      }
      const key = b.ruleId;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (b.articleIds.length === 0) {
        throw new ValidationError(
          `Binding for rule ${b.ruleId} must reference at least one article`,
        );
      }
      for (const artId of b.articleIds) {
        if (!articleIds.has(artId)) {
          throw new ReferentialIntegrityError(
            `Binding for rule ${b.ruleId} references unknown article ${artId}`,
          );
        }
      }
      bindings.push({
        ruleId: b.ruleId,
        articleStableIds: [...new Set(b.articleIds)].sort((x, y) =>
          x.localeCompare(y),
        ),
      });
    }
    return bindings;
  }

  private validateCrossReferences(articles: readonly Article[]): void {
    const articleIds = new Set(articles.map((a) => a.stableId));
    for (const a of articles) {
      for (const refId of a.references) {
        if (!articleIds.has(refId)) {
          throw new ReferentialIntegrityError(
            `Article ${a.stableId} references unknown article ${refId}`,
          );
        }
      }
    }
  }

  private validateSuccessionIntegrity(
    edges: readonly SuccessionEdge[],
    articles: readonly Article[],
  ): void {
    const byVersion = new Map<RegulationVersionId, Set<ArticleStableId>>();
    for (const a of articles) {
      let set = byVersion.get(a.versionId);
      if (!set) {
        set = new Set();
        byVersion.set(a.versionId, set);
      }
      set.add(a.stableId);
    }

    for (const edge of edges) {
      const fromArticle = articles.find(
        (a) => a.stableId === edge.fromStableId,
      );
      if (!fromArticle) continue;
      for (const toId of edge.toStableIds) {
        const toArticle = articles.find((a) => a.stableId === toId);
        if (!toArticle) continue;
        if (fromArticle.versionId === toArticle.versionId) {
          throw new ValidationError(
            `Succession edge ${edge.fromStableId}->${toId} must span different versions`,
          );
        }
      }
    }
  }
}
