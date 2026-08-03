import type { RevisionGraphInput } from '../../domain';

export const LAW_DRAFT_2_FIXTURE: RevisionGraphInput = {
  versions: [
    { id: 'LAW-V1', status: 'EFFECTIVE', effectiveFrom: '2026-01-01' },
    { id: 'LAW-DRAFT-2', status: 'DRAFT', effectiveFrom: null },
    { id: 'LAW-V2', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
  ],
  articles: [
    { stableId: 'ART-A', version: 'LAW-V1', label: '第十条' },
    { stableId: 'ART-B', version: 'LAW-V1', label: '第十一条', references: ['ART-A'] },
    { stableId: 'ART-C', version: 'LAW-V1', label: '第十二条' },
    { stableId: 'ART-D', version: 'LAW-V1', label: '第十三条' },
    { stableId: 'ART-E', version: 'LAW-V1', label: '第十四条' },
    { stableId: 'ART-F', version: 'LAW-V1', label: '第十五条' },
    { stableId: 'ART-Z', version: 'LAW-V1', label: '第十六条' },
    { stableId: 'ART-G', version: 'LAW-V1', label: '第十七条', references: ['ART-H'] },
    { stableId: 'ART-H', version: 'LAW-V1', label: '第十八条', references: ['ART-G'] },

    { stableId: 'ART-A1', version: 'LAW-DRAFT-2', label: '第十条之一' },
    { stableId: 'ART-A2', version: 'LAW-DRAFT-2', label: '第十条之二' },
    { stableId: 'ART-M', version: 'LAW-DRAFT-2', label: '第十条合并稿', references: ['ART-A1', 'ART-A2'] },
    { stableId: 'ART-B', version: 'LAW-DRAFT-2', label: '第十一条', references: ['ART-A1'] },
    { stableId: 'ART-C', version: 'LAW-DRAFT-2', label: '第十二条', references: ['ART-B', 'ART-M'] },
    { stableId: 'ART-D', version: 'LAW-DRAFT-2', label: '第十三条' },
    { stableId: 'ART-G2', version: 'LAW-DRAFT-2', label: '第十七条修订', references: ['ART-H'] },
    { stableId: 'ART-H', version: 'LAW-DRAFT-2', label: '第十八条延续', references: ['ART-G2'] },

    { stableId: 'ART-A1', version: 'LAW-V2', label: '第十条之一' },
    { stableId: 'ART-A2', version: 'LAW-V2', label: '第十条之二' },
    { stableId: 'ART-M', version: 'LAW-V2', label: '第十条终稿', references: ['ART-A1', 'ART-A2'] },
    { stableId: 'ART-B', version: 'LAW-V2', label: '第十一条', references: ['ART-A1'] },
    { stableId: 'ART-C', version: 'LAW-V2', label: '第十二条', references: ['ART-B', 'ART-M'] },
    { stableId: 'ART-D', version: 'LAW-V2', label: '第十三条' },
    { stableId: 'ART-E', version: 'LAW-V2', label: '第十四条' },
    { stableId: 'ART-F', version: 'LAW-V2', label: '第十五条' },
    { stableId: 'ART-G2', version: 'LAW-V2', label: '第十七条终稿', references: ['ART-H'] },
    { stableId: 'ART-H', version: 'LAW-V2', label: '第十八条终稿', references: ['ART-G2'] },
  ],
  succession: [
    { from: 'ART-A', to: ['ART-A1', 'ART-A2'], kind: 'SPLIT' },
    { from: ['ART-E', 'ART-F'], to: 'ART-M', kind: 'MERGE' },
    { from: 'ART-B', to: 'ART-B', kind: 'RENUMBER' },
    { from: 'ART-G', to: 'ART-G2', kind: 'REPLACE' },
  ],
  bindings: [
    { ruleId: 'RULE-DIRECT-SPLIT', articleIds: ['ART-A1'] },
    { ruleId: 'RULE-DIRECT-MERGE', articleIds: ['ART-M', 'ART-E'] },
    { ruleId: 'RULE-INDIRECT-C', articleIds: ['ART-C'] },
    { ruleId: 'RULE-CYCLE-G', articleIds: ['ART-G2'] },
    { ruleId: 'RULE-UNAFFECTED-D', articleIds: ['ART-D'] },
  ],
};
