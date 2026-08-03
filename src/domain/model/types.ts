export type VersionStatus = 'DRAFT' | 'PUBLISHED' | 'EFFECTIVE';

export type SuccessionKind = 'SPLIT' | 'MERGE' | 'RENUMBER' | 'REPLACE';

export type EdgeKind = 'SUCCESSION' | 'REFERENCE' | 'BOUND_RULE';

export type ImpactLevel = 'DIRECT' | 'INDIRECT' | 'UNAFFECTED';

export interface VersionInput {
  id: string;
  status: VersionStatus;
  effectiveFrom: string | null;
}

export interface ArticleInput {
  stableId: string;
  version: string;
  label: string;
  references?: ReadonlyArray<string>;
}

export interface SuccessionInput {
  from: string | ReadonlyArray<string>;
  to: string | ReadonlyArray<string>;
  kind: SuccessionKind;
}

export interface BindingInput {
  ruleId: string;
  articleIds: ReadonlyArray<string>;
}

export interface RevisionGraphInput {
  versions: ReadonlyArray<VersionInput>;
  articles: ReadonlyArray<ArticleInput>;
  succession: ReadonlyArray<SuccessionInput>;
  bindings: ReadonlyArray<BindingInput>;
}

export interface ArticleNode {
  readonly stableId: string;
  readonly versionId: string;
  readonly label: string;
  readonly key: ArticleKey;
}

export type ArticleKey = string;

export interface GraphEdge {
  readonly from: ArticleKey;
  readonly to: ArticleKey;
  readonly kind: EdgeKind;
  readonly successionKind: SuccessionKind | null;
  readonly ruleId: string | null;
  readonly refStableId: string | null;
}

export interface RuleNode {
  readonly ruleId: string;
  readonly boundKeys: ReadonlyArray<ArticleKey>;
}

export interface VersionNode {
  readonly id: string;
  readonly status: VersionStatus;
  readonly effectiveFrom: string | null;
  readonly ordinal: number;
}

export interface ImpactQuery {
  readonly fromVersionId: string;
  readonly toVersionId: string;
  readonly queryAt: string;
  readonly includeDrafts?: boolean;
  readonly maxPathLength?: number;
  readonly maxPathsPerTarget?: number;
}

export interface PropagationPath {
  readonly nodes: ReadonlyArray<ArticleKey>;
  readonly edges: ReadonlyArray<EdgeKind>;
  readonly length: number;
}

export interface ArticleImpact {
  readonly key: ArticleKey;
  readonly stableId: string;
  readonly versionId: string;
  readonly label: string;
  readonly level: ImpactLevel;
  readonly paths: ReadonlyArray<PropagationPath>;
}

export interface RuleImpact {
  readonly ruleId: string;
  readonly level: ImpactLevel;
  readonly articleKeys: ReadonlyArray<ArticleKey>;
  readonly paths: ReadonlyArray<PropagationPath>;
}

export interface MissingSuccession {
  readonly stableId: string;
  readonly fromVersionId: string | null;
  readonly toVersionId: string | null;
  readonly reason: string;
}

export interface DanglingReference {
  readonly fromKey: ArticleKey;
  readonly toStableId: string;
  readonly reason: string;
}

export interface ImpactResult {
  readonly query: ImpactQuery;
  readonly articles: ReadonlyArray<ArticleImpact>;
  readonly rules: ReadonlyArray<RuleImpact>;
  readonly directKeys: ReadonlyArray<ArticleKey>;
  readonly indirectKeys: ReadonlyArray<ArticleKey>;
  readonly unaffectedKeys: ReadonlyArray<ArticleKey>;
  readonly missingSuccession: ReadonlyArray<MissingSuccession>;
  readonly danglingReferences: ReadonlyArray<DanglingReference>;
  readonly truncated: boolean;
}

export interface Snapshot {
  readonly id: string;
  readonly createdAt: string;
  readonly query: ImpactQuery;
  readonly graphHash: string;
  readonly frozenVersions: ReadonlyArray<VersionNode>;
  readonly frozenArticles: ReadonlyArray<ArticleNode>;
  readonly frozenEdges: ReadonlyArray<GraphEdge>;
  readonly frozenRules: ReadonlyArray<RuleNode>;
  readonly result: ImpactResult;
}

export interface ImportReport {
  readonly importedVersions: number;
  readonly importedArticles: number;
  readonly importedSuccessions: number;
  readonly importedBindings: number;
  readonly duplicateVersions: number;
  readonly duplicateArticles: number;
  readonly duplicateSuccessions: number;
  readonly duplicateBindings: number;
  readonly danglingReferences: ReadonlyArray<DanglingReference>;
  readonly unresolvedSuccessionEndpoints: ReadonlyArray<{
    readonly succession: SuccessionInput;
    readonly missing: ReadonlyArray<string>;
  }>;
}
