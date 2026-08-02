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

export function sampleGraphInput(): RevisionGraphInput {
  return {
    versions: [
      { id: vid('LAW-V1'), status: VersionStatus.EFFECTIVE, effectiveFrom: '2026-01-01' },
      { id: vid('LAW-V2'), status: VersionStatus.PUBLISHED, effectiveFrom: '2027-01-01' },
    ],
    articles: [
      { stableId: aid('ART-A'), version: vid('LAW-V1'), label: '第十条', references: [] },
      { stableId: aid('ART-B'), version: vid('LAW-V1'), label: '第十一条', references: [aid('ART-A')] },
      { stableId: aid('ART-A1'), version: vid('LAW-V2'), label: '第十二条', references: [] },
      { stableId: aid('ART-A2'), version: vid('LAW-V2'), label: '第十三条', references: [] },
    ],
    succession: [
      { from: aid('ART-A'), to: [aid('ART-A1'), aid('ART-A2')], kind: SuccessionKind.SPLIT },
    ],
    bindings: [
      { ruleId: rid('RULE-ELIGIBILITY-01'), articleIds: [aid('ART-A')] },
      { ruleId: rid('RULE-SERVICE-02'), articleIds: [aid('ART-B')] },
    ],
  };
}

export function mergeGraphInput(): RevisionGraphInput {
  return {
    versions: [
      { id: vid('LAW-V1'), status: VersionStatus.EFFECTIVE, effectiveFrom: '2026-01-01' },
      { id: vid('LAW-V2'), status: VersionStatus.PUBLISHED, effectiveFrom: '2027-01-01' },
    ],
    articles: [
      { stableId: aid('ART-X'), version: vid('LAW-V1'), label: '第一条', references: [] },
      { stableId: aid('ART-Y'), version: vid('LAW-V1'), label: '第二条', references: [] },
      { stableId: aid('ART-Z'), version: vid('LAW-V2'), label: '合并条', references: [] },
    ],
    succession: [
      { from: aid('ART-X'), to: [aid('ART-Z')], kind: SuccessionKind.MERGE },
      { from: aid('ART-Y'), to: [aid('ART-Z')], kind: SuccessionKind.MERGE },
    ],
    bindings: [
      { ruleId: rid('RULE-X'), articleIds: [aid('ART-X')] },
      { ruleId: rid('RULE-Y'), articleIds: [aid('ART-Y')] },
      { ruleId: rid('RULE-Z'), articleIds: [aid('ART-Z')] },
    ],
  };
}

export function cycleGraphInput(): RevisionGraphInput {
  return {
    versions: [
      { id: vid('V1'), status: VersionStatus.EFFECTIVE, effectiveFrom: '2026-01-01' },
      { id: vid('V2'), status: VersionStatus.PUBLISHED, effectiveFrom: '2027-01-01' },
    ],
    articles: [
      { stableId: aid('C1'), version: vid('V1'), label: 'C1', references: [aid('C3')] },
      { stableId: aid('C2'), version: vid('V1'), label: 'C2', references: [aid('C1')] },
      { stableId: aid('C3'), version: vid('V1'), label: 'C3', references: [aid('C2')] },
      { stableId: aid('C4'), version: vid('V1'), label: 'C4', references: [aid('C1')] },
      { stableId: aid('N1'), version: vid('V2'), label: 'N1', references: [] },
    ],
    succession: [
      { from: aid('C1'), to: [aid('N1')], kind: SuccessionKind.REVISE },
    ],
    bindings: [
      { ruleId: rid('R-CYCLE'), articleIds: [aid('C3')] },
    ],
  };
}

export function missingSuccessionGraphInput(): RevisionGraphInput {
  return {
    versions: [
      { id: vid('V1'), status: VersionStatus.EFFECTIVE, effectiveFrom: '2026-01-01' },
      { id: vid('V2'), status: VersionStatus.PUBLISHED, effectiveFrom: '2027-01-01' },
    ],
    articles: [
      { stableId: aid('KEEP'), version: vid('V1'), label: '保留条', references: [] },
      { stableId: aid('GONE'), version: vid('V1'), label: '消失条', references: [] },
      { stableId: aid('NEW1'), version: vid('V2'), label: '新条1', references: [] },
    ],
    succession: [
      { from: aid('KEEP'), to: [aid('NEW1')], kind: SuccessionKind.RENAME },
    ],
    bindings: [
      { ruleId: rid('R-GONE'), articleIds: [aid('GONE')] },
    ],
  };
}

export function sameDayVersionsGraphInput(): RevisionGraphInput {
  return {
    versions: [
      { id: vid('V1'), status: VersionStatus.EFFECTIVE, effectiveFrom: '2026-01-01' },
      { id: vid('V2A'), status: VersionStatus.PUBLISHED, effectiveFrom: '2027-01-01' },
      { id: vid('V2B'), status: VersionStatus.PUBLISHED, effectiveFrom: '2027-01-01' },
    ],
    articles: [
      { stableId: aid('D1'), version: vid('V1'), label: 'D1', references: [] },
      { stableId: aid('D2A'), version: vid('V2A'), label: 'D2A', references: [] },
      { stableId: aid('D2B'), version: vid('V2B'), label: 'D2B', references: [] },
    ],
    succession: [
      { from: aid('D1'), to: [aid('D2A')], kind: SuccessionKind.REVISE },
      { from: aid('D1'), to: [aid('D2B')], kind: SuccessionKind.REVISE },
    ],
    bindings: [],
  };
}

export function largeGraphInput(size: number): RevisionGraphInput {
  const versions = [
    { id: vid('V1'), status: VersionStatus.EFFECTIVE, effectiveFrom: '2026-01-01' },
    { id: vid('V2'), status: VersionStatus.PUBLISHED, effectiveFrom: '2027-01-01' },
  ];
  const articles = [];
  const succession = [];
  for (let i = 0; i < size; i++) {
    const oldId = aid(`OLD-${String(i).padStart(4, '0')}`);
    const newId = aid(`NEW-${String(i).padStart(4, '0')}`);
    const refs: ArticleStableId[] = [];
    if (i > 0) refs.push(aid(`OLD-${String(i - 1).padStart(4, '0')}`));
    articles.push({
      stableId: oldId,
      version: vid('V1'),
      label: `Old ${i}`,
      references: refs,
    });
    articles.push({
      stableId: newId,
      version: vid('V2'),
      label: `New ${i}`,
      references: [],
    });
    succession.push({
      from: oldId,
      to: [newId],
      kind: SuccessionKind.REVISE,
    });
  }
  return { versions, articles, succession, bindings: [] };
}
