import {
  ArticleStableId,
  RegulationVersionId,
  RuleId,
} from './branded-types';
import { Article } from './article';
import { BusinessRuleBinding } from './business-rule-binding';
import { RegulationVersion } from './regulation-version';
import { SuccessionEdge } from './succession-edge';

export interface ReadOnlyRevisionGraph {
  readonly versions: readonly RegulationVersion[];
  readonly articles: readonly Article[];
  readonly successionEdges: readonly SuccessionEdge[];
  readonly bindings: readonly BusinessRuleBinding[];

  getVersion(id: RegulationVersionId): RegulationVersion | undefined;
  getArticle(id: ArticleStableId): Article | undefined;
  getArticlesByVersion(versionId: RegulationVersionId): readonly Article[];
  getSuccessionsFrom(articleId: ArticleStableId): readonly SuccessionEdge[];
  getSuccessionsTo(articleId: ArticleStableId): readonly SuccessionEdge[];
  getReverseReferences(articleId: ArticleStableId): readonly ArticleStableId[];
  getBindingsForArticle(
    articleId: ArticleStableId,
  ): readonly BusinessRuleBinding[];
  getBindingsForRule(ruleId: RuleId): readonly BusinessRuleBinding[];
  getArticlesBoundToRule(ruleId: RuleId): readonly ArticleStableId[];
  fingerprint(): string;
}

export class RevisionGraph implements ReadOnlyRevisionGraph {
  readonly versions: readonly RegulationVersion[];
  readonly articles: readonly Article[];
  readonly successionEdges: readonly SuccessionEdge[];
  readonly bindings: readonly BusinessRuleBinding[];

  private readonly versionMap: ReadonlyMap<
    RegulationVersionId,
    RegulationVersion
  >;
  private readonly articleMap: ReadonlyMap<ArticleStableId, Article>;
  private readonly articlesByVersionMap: ReadonlyMap<
    RegulationVersionId,
    readonly Article[]
  >;
  private readonly successionFromMap: ReadonlyMap<
    ArticleStableId,
    readonly SuccessionEdge[]
  >;
  private readonly successionToMap: ReadonlyMap<
    ArticleStableId,
    readonly SuccessionEdge[]
  >;
  private readonly reverseRefsMap: ReadonlyMap<
    ArticleStableId,
    readonly ArticleStableId[]
  >;
  private readonly bindingsByArticleMap: ReadonlyMap<
    ArticleStableId,
    readonly BusinessRuleBinding[]
  >;
  private readonly bindingsByRuleMap: ReadonlyMap<
    RuleId,
    readonly BusinessRuleBinding[]
  >;
  private readonly articlesByRuleMap: ReadonlyMap<
    RuleId,
    readonly ArticleStableId[]
  >;
  private readonly _fingerprint: string;

  constructor(
    versions: readonly RegulationVersion[],
    articles: readonly Article[],
    successionEdges: readonly SuccessionEdge[],
    bindings: readonly BusinessRuleBinding[],
  ) {
    this.versions = [...versions].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    this.articles = [...articles].sort((a, b) =>
      a.stableId.localeCompare(b.stableId),
    );
    this.successionEdges = [...successionEdges].sort((a, b) => {
      const fromCmp = a.fromStableId.localeCompare(b.fromStableId);
      if (fromCmp !== 0) return fromCmp;
      const kindCmp = a.kind.localeCompare(b.kind);
      if (kindCmp !== 0) return kindCmp;
      const aTo = [...a.toStableIds].sort().join(',');
      const bTo = [...b.toStableIds].sort().join(',');
      return aTo.localeCompare(bTo);
    });
    this.bindings = [...bindings].sort((a, b) =>
      a.ruleId.localeCompare(b.ruleId),
    );

    const vMap = new Map<RegulationVersionId, RegulationVersion>();
    for (const v of this.versions) {
      vMap.set(v.id, v);
    }
    this.versionMap = vMap;

    const aMap = new Map<ArticleStableId, Article>();
    const byVersion = new Map<RegulationVersionId, Article[]>();
    for (const a of this.articles) {
      aMap.set(a.stableId, a);
      const arr = byVersion.get(a.versionId);
      if (arr) {
        arr.push(a);
      } else {
        byVersion.set(a.versionId, [a]);
      }
    }
    this.articleMap = aMap;
    {
      const sorted = new Map<RegulationVersionId, readonly Article[]>();
      for (const [k, v] of byVersion) {
        sorted.set(
          k,
          [...v].sort((a, b) => a.stableId.localeCompare(b.stableId)),
        );
      }
      this.articlesByVersionMap = sorted;
    }

    const fromMap = new Map<ArticleStableId, SuccessionEdge[]>();
    const toMap = new Map<ArticleStableId, SuccessionEdge[]>();
    for (const edge of this.successionEdges) {
      const fromArr = fromMap.get(edge.fromStableId);
      if (fromArr) {
        fromArr.push(edge);
      } else {
        fromMap.set(edge.fromStableId, [edge]);
      }
      for (const toId of edge.toStableIds) {
        const toArr = toMap.get(toId);
        if (toArr) {
          toArr.push(edge);
        } else {
          toMap.set(toId, [edge]);
        }
      }
    }
    this.successionFromMap = fromMap;
    this.successionToMap = toMap;

    const revRefs = new Map<ArticleStableId, ArticleStableId[]>();
    for (const article of this.articles) {
      for (const refId of article.references) {
        const arr = revRefs.get(refId);
        if (arr) {
          arr.push(article.stableId);
        } else {
          revRefs.set(refId, [article.stableId]);
        }
      }
    }
    {
      const sorted = new Map<ArticleStableId, readonly ArticleStableId[]>();
      for (const [k, v] of revRefs) {
        sorted.set(k, [...v].sort((a, b) => a.localeCompare(b)));
      }
      this.reverseRefsMap = sorted;
    }

    const byArticle = new Map<ArticleStableId, BusinessRuleBinding[]>();
    const byRule = new Map<RuleId, BusinessRuleBinding[]>();
    const artsByRule = new Map<RuleId, ArticleStableId[]>();
    for (const binding of this.bindings) {
      for (const artId of binding.articleStableIds) {
        const arr = byArticle.get(artId);
        if (arr) {
          arr.push(binding);
        } else {
          byArticle.set(artId, [binding]);
        }
      }
      const ruleArr = byRule.get(binding.ruleId);
      if (ruleArr) {
        ruleArr.push(binding);
      } else {
        byRule.set(binding.ruleId, [binding]);
      }
      const artArr = artsByRule.get(binding.ruleId);
      const merged = artArr
        ? [...new Set([...artArr, ...binding.articleStableIds])]
        : [...binding.articleStableIds];
      merged.sort((a, b) => a.localeCompare(b));
      artsByRule.set(binding.ruleId, merged);
    }
    this.bindingsByArticleMap = byArticle;
    this.bindingsByRuleMap = byRule;
    this.articlesByRuleMap = artsByRule;

    this._fingerprint = this.computeFingerprint();
  }

  getVersion(id: RegulationVersionId): RegulationVersion | undefined {
    return this.versionMap.get(id);
  }

  getArticle(id: ArticleStableId): Article | undefined {
    return this.articleMap.get(id);
  }

  getArticlesByVersion(versionId: RegulationVersionId): readonly Article[] {
    return this.articlesByVersionMap.get(versionId) ?? [];
  }

  getSuccessionsFrom(articleId: ArticleStableId): readonly SuccessionEdge[] {
    return this.successionFromMap.get(articleId) ?? [];
  }

  getSuccessionsTo(articleId: ArticleStableId): readonly SuccessionEdge[] {
    return this.successionToMap.get(articleId) ?? [];
  }

  getReverseReferences(articleId: ArticleStableId): readonly ArticleStableId[] {
    return this.reverseRefsMap.get(articleId) ?? [];
  }

  getBindingsForArticle(
    articleId: ArticleStableId,
  ): readonly BusinessRuleBinding[] {
    return this.bindingsByArticleMap.get(articleId) ?? [];
  }

  getBindingsForRule(ruleId: RuleId): readonly BusinessRuleBinding[] {
    return this.bindingsByRuleMap.get(ruleId) ?? [];
  }

  getArticlesBoundToRule(ruleId: RuleId): readonly ArticleStableId[] {
    return this.articlesByRuleMap.get(ruleId) ?? [];
  }

  fingerprint(): string {
    return this._fingerprint;
  }

  private computeFingerprint(): string {
    const payload = {
      versions: this.versions.map((v) => ({
        id: v.id,
        status: v.status,
        effectiveFrom: v.effectiveFrom,
      })),
      articles: this.articles.map((a) => ({
        stableId: a.stableId,
        versionId: a.versionId,
        label: a.label,
        references: [...a.references].sort(),
      })),
      succession: this.successionEdges.map((s) => ({
        from: s.fromStableId,
        to: [...s.toStableIds].sort(),
        kind: s.kind,
      })),
      bindings: this.bindings.map((b) => ({
        ruleId: b.ruleId,
        articleIds: [...b.articleStableIds].sort(),
      })),
    };
    return hashString(JSON.stringify(payload));
  }
}

function hashString(input: string): string {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const h = (4294967296 * (2097151 & h2) + (h1 >>> 0))
    .toString(16)
    .padStart(16, '0');
  return `fp_${h}`;
}
