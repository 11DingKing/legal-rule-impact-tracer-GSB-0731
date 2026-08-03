import {
  ArticleStableId,
  RegulationVersionId,
  RuleId,
} from './branded-types';
import { ImpactLevel } from './enums';
import { PropagationPath } from './propagation-path';
import { QueryTimepoint } from './query-timepoint';
import { EdgeSequence } from './edge-sequence';

export interface ArticleImpact {
  readonly stableId: ArticleStableId;
  readonly label: string;
  readonly versionId: RegulationVersionId;
  readonly level: ImpactLevel;
}

export interface RuleImpact {
  readonly ruleId: RuleId;
  readonly level: ImpactLevel;
  readonly boundArticleIds: readonly ArticleStableId[];
}

export interface RuleWitness {
  readonly ruleId: RuleId;
  readonly level: ImpactLevel;
  readonly shortestDistance: number;
  readonly equalLengthPathCount: number;
  readonly witness: PropagationPath;
}

export interface MissingSuccession {
  readonly stableId: ArticleStableId;
  readonly label: string;
  readonly versionId: RegulationVersionId;
  readonly reason: string;
}

export interface ImpactReport {
  readonly sourceVersionId: RegulationVersionId;
  readonly targetVersionId: RegulationVersionId;
  readonly queriedAt: string;
  readonly timepoint: QueryTimepoint;
  readonly graphFingerprint: string;
  readonly edgeSequence: EdgeSequence;
  readonly directArticles: readonly ArticleImpact[];
  readonly indirectArticles: readonly ArticleImpact[];
  readonly unaffectedArticles: readonly ArticleImpact[];
  readonly directRules: readonly RuleImpact[];
  readonly indirectRules: readonly RuleImpact[];
  readonly unaffectedRules: readonly RuleImpact[];
  readonly ruleWitnesses: readonly RuleWitness[];
  readonly missingSuccessions: readonly MissingSuccession[];
  readonly paths: readonly PropagationPath[];
}
