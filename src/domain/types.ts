/**
 * Core domain types for the legal rule impact tracer.
 *
 * This module is persistence- and transport-agnostic: no NestJS, no SQLite.
 */

export type VersionStatus = 'DRAFT' | 'PUBLISHED' | 'EFFECTIVE';

export const VERSION_STATUSES: readonly VersionStatus[] = [
  'DRAFT',
  'PUBLISHED',
  'EFFECTIVE',
] as const;

export type SuccessionKind = 'RENUMBER' | 'SPLIT' | 'MERGE';

export const SUCCESSION_KINDS: readonly SuccessionKind[] = [
  'RENUMBER',
  'SPLIT',
  'MERGE',
] as const;

export type ImpactLevel = 'DIRECT' | 'INDIRECT' | 'UNAFFECTED';

export interface LawVersion {
  readonly id: string;
  readonly status: VersionStatus;
  /** ISO calendar date (YYYY-MM-DD) or null when not yet scheduled. */
  readonly effectiveFrom: string | null;
}

export interface Article {
  readonly stableId: string;
  readonly versionId: string;
  readonly label: string;
}

/** Cross-reference edge inside one version: `fromId` cites `toId`. */
export interface ReferenceEdge {
  readonly versionId: string;
  readonly fromId: string;
  readonly toId: string;
}

/**
 * Explicit succession edge between stable article IDs.
 * Identity across versions is carried ONLY by these edges; never inferred
 * from labels or text similarity.
 */
export interface SuccessionEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly kind: SuccessionKind;
}

export interface RuleBinding {
  readonly ruleId: string;
  readonly articleId: string;
}

/** Complete graph slice needed to evaluate one revision query. */
export interface RevisionGraph {
  readonly versions: readonly LawVersion[];
  readonly articles: readonly Article[];
  readonly references: readonly ReferenceEdge[];
  readonly succession: readonly SuccessionEdge[];
  readonly bindings: readonly RuleBinding[];
}

export interface ImpactQuery {
  readonly fromVersion: string;
  readonly toVersion: string;
  /** ISO timestamp captured at query time; frozen into the snapshot. */
  readonly asOf: string;
}

export type ChangeReason = 'SUCCESSION';

export interface ChangedArticle {
  readonly stableId: string;
  readonly reason: ChangeReason;
  /** Succession edges leaving this article. */
  readonly succession: readonly SuccessionEdge[];
}

/**
 * An article of the from-version with no succession edge and no same-ID
 * counterpart in the to-version. Its fate is unknown: it is reported, never
 * silently treated as unchanged, and never re-linked by label similarity.
 * It is not a change source by itself, but it still participates in the
 * cross-reference graph, so it can receive indirect impact.
 */
export interface MissingSuccessionEntry {
  readonly stableId: string;
  /** Rules bound to this article; they need human review, not guesses. */
  readonly boundRuleIds: readonly string[];
}

export type PathEdgeKind = 'SUCCESSION' | 'REFERENCE_REVERSE';

export interface PathEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly kind: PathEdgeKind;
}

/**
 * One complete propagation path from a changed (or unresolved) article to a
 * bound article of `ruleId`. Nodes are article stable IDs; edges are the
 * traversed graph edges between consecutive nodes.
 */
export interface PropagationPath {
  readonly ruleId: string;
  readonly impact: Exclude<ImpactLevel, 'UNAFFECTED'>;
  readonly nodes: readonly string[];
  readonly edges: readonly PathEdge[];
}

export interface RuleImpact {
  readonly ruleId: string;
  readonly level: ImpactLevel;
  /** Bound articles through which the impact reaches the rule; empty for UNAFFECTED. */
  readonly via: readonly string[];
}

export interface VersionContextEntry {
  readonly id: string;
  readonly status: VersionStatus;
  readonly effectiveFrom: string | null;
}

export interface ImpactResult {
  readonly query: ImpactQuery;
  readonly versionContext: {
    readonly from: VersionContextEntry;
    readonly to: VersionContextEntry;
  };
  readonly changedArticles: readonly ChangedArticle[];
  /** Articles of the from-version with no succession edge and no same-ID carry-over. */
  readonly missingSuccession: readonly MissingSuccessionEntry[];
  /** Articles of the from-version carried into the to-version with identical stable ID. */
  readonly unchangedArticles: readonly string[];
  /** Articles present only in the to-version with no incoming succession edge. */
  readonly addedArticles: readonly string[];
  readonly rules: {
    readonly direct: readonly RuleImpact[];
    readonly indirect: readonly RuleImpact[];
    readonly unaffected: readonly RuleImpact[];
  };
  readonly paths: readonly PropagationPath[];
  /** Every edge the evaluation traversed, frozen for snapshot replay. */
  readonly traversedEdges: readonly PathEdge[];
}
