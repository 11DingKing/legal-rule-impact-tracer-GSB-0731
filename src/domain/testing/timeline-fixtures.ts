import {
  ArticleStableId,
  RegulationVersionId,
  RuleId,
} from '../models/branded-types';
import { SuccessionKind, VersionStatus } from '../models/enums';
import { RevisionGraphInput } from '../ports/graph-input';

export function vid(id: string): RegulationVersionId {
  return id as RegulationVersionId;
}
export function aid(id: string): ArticleStableId {
  return id as ArticleStableId;
}
export function rid(id: string): RuleId {
  return id as RuleId;
}

export function timelineGraphInput(): RevisionGraphInput {
  return {
    versions: [
      { id: vid('LAW-V1'), status: VersionStatus.EFFECTIVE, effectiveFrom: '2026-01-01' },
      { id: vid('LAW-DRAFT-2'), status: VersionStatus.DRAFT, effectiveFrom: null },
      { id: vid('LAW-V2'), status: VersionStatus.PUBLISHED, effectiveFrom: '2027-01-01' },
    ],
    articles: [
      { stableId: aid('T-A'), version: vid('LAW-V1'), label: 'V1-A', references: [] },
      { stableId: aid('T-B'), version: vid('LAW-V1'), label: 'V1-B', references: [aid('T-A')] },
      { stableId: aid('T-C'), version: vid('LAW-V1'), label: 'V1-C', references: [] },
      { stableId: aid('T-D'), version: vid('LAW-V1'), label: 'V1-D (missing edge)', references: [] },
      { stableId: aid('T-A1'), version: vid('LAW-DRAFT-2'), label: 'DRAFT-A1', references: [] },
      { stableId: aid('T-A2'), version: vid('LAW-DRAFT-2'), label: 'DRAFT-A2', references: [] },
      { stableId: aid('T-M'), version: vid('LAW-DRAFT-2'), label: 'DRAFT-M', references: [] },
      { stableId: aid('T-A1V2'), version: vid('LAW-V2'), label: 'V2-A1', references: [] },
      { stableId: aid('T-A2V2'), version: vid('LAW-V2'), label: 'V2-A2', references: [] },
      { stableId: aid('T-MV2'), version: vid('LAW-V2'), label: 'V2-M', references: [] },
      { stableId: aid('T-C1'), version: vid('LAW-V2'), label: 'V2-C1', references: [aid('T-A1V2')] },
      { stableId: aid('T-D1'), version: vid('LAW-V2'), label: 'V2-D1 (backfill target)', references: [] },
    ],
    succession: [
      { from: aid('T-A'), to: [aid('T-A1'), aid('T-A2')], kind: SuccessionKind.SPLIT },
      { from: aid('T-A'), to: [aid('T-M')], kind: SuccessionKind.MERGE },
      { from: aid('T-B'), to: [aid('T-M')], kind: SuccessionKind.MERGE },
      { from: aid('T-A'), to: [aid('T-A1V2'), aid('T-A2V2')], kind: SuccessionKind.SPLIT },
      { from: aid('T-A'), to: [aid('T-MV2')], kind: SuccessionKind.MERGE },
      { from: aid('T-B'), to: [aid('T-MV2')], kind: SuccessionKind.MERGE },
      { from: aid('T-C'), to: [aid('T-C1')], kind: SuccessionKind.REVISE },
    ],
    bindings: [
      { ruleId: rid('T-RULE-A'), articleIds: [aid('T-A')] },
      { ruleId: rid('T-RULE-B'), articleIds: [aid('T-B')] },
      { ruleId: rid('T-RULE-C'), articleIds: [aid('T-C')] },
      { ruleId: rid('T-RULE-D'), articleIds: [aid('T-D')] },
      { ruleId: rid('T-RULE-C1'), articleIds: [aid('T-C1')] },
    ],
  };
}

export function timelineWithBackfillInput(): RevisionGraphInput {
  const base = timelineGraphInput();
  return {
    ...base,
    succession: [
      ...base.succession,
      { from: aid('T-D'), to: [aid('T-D1')], kind: SuccessionKind.REVISE },
    ],
  };
}
