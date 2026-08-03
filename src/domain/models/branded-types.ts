declare const brand: unique symbol;

export type Brand<T, B> = T & { readonly [brand]: B };

export type RegulationVersionId = Brand<string, 'RegulationVersionId'>;
export type ArticleStableId = Brand<string, 'ArticleStableId'>;
export type RuleId = Brand<string, 'RuleId'>;
export type SnapshotId = Brand<string, 'SnapshotId'>;

export const RegulationVersionId = (value: string): RegulationVersionId =>
  value as RegulationVersionId;
export const ArticleStableId = (value: string): ArticleStableId =>
  value as ArticleStableId;
export const RuleId = (value: string): RuleId => value as RuleId;
export const SnapshotId = (value: string): SnapshotId =>
  value as SnapshotId;
