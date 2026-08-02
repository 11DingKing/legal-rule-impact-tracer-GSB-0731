/**
 * Domain vocabulary for the revision-impact graph.
 *
 * These types are the single source of truth shared by the pure evaluation
 * module, the SQLite adapters, and the HTTP layer. Keeping them free of any
 * framework or persistence concern is what lets the impact rules live entirely
 * inside `impact.ts`.
 */

export const VERSION_STATUSES = ['DRAFT', 'PUBLISHED', 'EFFECTIVE'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const SUCCESSION_KINDS = ['RENUMBER', 'SPLIT', 'MERGE'] as const;
export type SuccessionKind = (typeof SUCCESSION_KINDS)[number];

/** How a version relates to a query's `asOf` instant. */
export type Effectiveness = 'DRAFT' | 'NOT_YET_EFFECTIVE' | 'EFFECTIVE';

/** Impact classification for a bound business rule. */
export type ImpactLevel = 'DIRECT' | 'INDIRECT' | 'UNAFFECTED';

export interface LawVersion {
  readonly id: string;
  readonly status: VersionStatus;
  /** ISO date (YYYY-MM-DD) or null for drafts with no effective date. */
  readonly effectiveFrom: string | null;
}

export interface Article {
  readonly stableId: string;
  readonly versionId: string;
  readonly label: string;
}

/** A directed cross-reference: `fromId` cites `toId` within `versionId`. */
export interface ReferenceEdge {
  readonly versionId: string;
  readonly fromId: string;
  readonly toId: string;
}

/** An explicit succession edge connecting stable IDs across versions. */
export interface SuccessionEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly kind: SuccessionKind;
}

/** Binding of a business rule to a stable article ID. */
export interface RuleBinding {
  readonly ruleId: string;
  readonly articleId: string;
}

/**
 * The whole graph in a normalized, order-independent shape. Every consumer
 * sorts before use, so the array order carries no meaning.
 */
export interface RevisionGraph {
  readonly versions: readonly LawVersion[];
  readonly articles: readonly Article[];
  readonly references: readonly ReferenceEdge[];
  readonly succession: readonly SuccessionEdge[];
  readonly bindings: readonly RuleBinding[];
}

/** A fully specified impact query. `asOf` is an ISO-8601 instant. */
export interface ImpactQuery {
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly asOf: string;
}

/** Kinds of edges that can appear in a traversal path. */
export type PathEdgeKind = 'SUCCESSION' | 'REFERENCE_REVERSE';

export interface PathEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly kind: PathEdgeKind;
}

/** A single, ordered propagation path recorded for a rule. */
export interface ImpactPath {
  readonly ruleId: string;
  readonly impact: Exclude<ImpactLevel, 'UNAFFECTED'>;
  readonly nodes: readonly string[];
  readonly edges: readonly PathEdge[];
}

export interface ChangedArticle {
  readonly stableId: string;
  readonly reason: 'SUCCESSION';
  readonly succession: readonly SuccessionEdge[];
}

export interface MissingSuccession {
  readonly stableId: string;
  readonly boundRuleIds: readonly string[];
}

export interface RuleImpact {
  readonly ruleId: string;
  readonly level: ImpactLevel;
  readonly via: readonly string[];
  /** One shortest, lexicographically smallest witnessing path (or null). */
  readonly witness: ImpactPath | null;
  /** Number of equal-length shortest witnesses. */
  readonly witnessCount: number;
}

export interface VersionContextEntry {
  readonly id: string;
  readonly status: VersionStatus;
  readonly effectiveFrom: string | null;
  readonly effectivenessAtAsOf: Effectiveness;
}

export interface Diagnostic {
  readonly code: 'MISSING_SUCCESSION';
  readonly stableId: string;
  readonly boundRuleIds: readonly string[];
  readonly message: string;
}

export interface ImpactResult {
  readonly query: ImpactQuery;
  readonly versionContext: {
    readonly from: VersionContextEntry;
    readonly to: VersionContextEntry;
  };
  readonly changedArticles: readonly ChangedArticle[];
  readonly missingSuccession: readonly MissingSuccession[];
  readonly unchangedArticles: readonly string[];
  readonly addedArticles: readonly string[];
  readonly rules: {
    readonly direct: readonly RuleImpact[];
    readonly indirect: readonly RuleImpact[];
    readonly unaffected: readonly RuleImpact[];
  };
  readonly diagnostics: readonly Diagnostic[];
  readonly paths: readonly ImpactPath[];
  readonly traversedEdges: readonly PathEdge[];
}
