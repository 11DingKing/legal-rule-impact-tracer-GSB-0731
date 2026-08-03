import { ArticleStableId, RegulationVersionId, RuleId } from '../models/branded-types';
import { SuccessionKind, VersionStatus } from '../models/enums';

export interface VersionInput {
  id: RegulationVersionId;
  status: VersionStatus;
  effectiveFrom: string | null;
}

export interface ArticleInput {
  stableId: ArticleStableId;
  version: RegulationVersionId;
  label: string;
  references?: ArticleStableId[];
}

export interface SuccessionInput {
  from: ArticleStableId;
  to: ArticleStableId[];
  kind: SuccessionKind;
}

export interface BindingInput {
  ruleId: RuleId;
  articleIds: ArticleStableId[];
}

export interface RevisionGraphInput {
  versions: VersionInput[];
  articles: ArticleInput[];
  succession: SuccessionInput[];
  bindings: BindingInput[];
}
