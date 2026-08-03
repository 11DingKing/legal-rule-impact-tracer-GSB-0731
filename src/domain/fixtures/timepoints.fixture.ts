import type { RevisionGraphInput } from '../../domain';

export const TIMEPOINT_BASE_FIXTURE: RevisionGraphInput = {
  versions: [
    { id: 'LAW-V1', status: 'EFFECTIVE', effectiveFrom: '2026-01-01' },
    { id: 'LAW-DRAFT-2', status: 'DRAFT', effectiveFrom: null },
    { id: 'LAW-V2', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
  ],
  articles: [
    { stableId: 'A', version: 'LAW-V1', label: 'A-v1' },
    { stableId: 'B', version: 'LAW-V1', label: 'B-v1', references: ['A'] },
    { stableId: 'C', version: 'LAW-V1', label: 'C-v1', references: ['B'] },
    { stableId: 'Z', version: 'LAW-V1', label: 'Z-v1' },
    { stableId: 'G', version: 'LAW-V1', label: 'G-v1', references: ['H'] },
    { stableId: 'H', version: 'LAW-V1', label: 'H-v1', references: ['G'] },

    { stableId: 'A', version: 'LAW-DRAFT-2', label: 'A-draft', references: ['B'] },
    { stableId: 'B', version: 'LAW-DRAFT-2', label: 'B-draft' },
    { stableId: 'C', version: 'LAW-DRAFT-2', label: 'C-draft', references: ['B'] },
    { stableId: 'G2', version: 'LAW-DRAFT-2', label: 'G2-draft', references: ['H'] },
    { stableId: 'H', version: 'LAW-DRAFT-2', label: 'H-draft', references: ['G2'] },

    { stableId: 'A2', version: 'LAW-V2', label: 'A-v2' },
    { stableId: 'B', version: 'LAW-V2', label: 'B-v2', references: ['A2'] },
    { stableId: 'C', version: 'LAW-V2', label: 'C-v2', references: ['B'] },
    { stableId: 'G2', version: 'LAW-V2', label: 'G-v2', references: ['H'] },
    { stableId: 'H', version: 'LAW-V2', label: 'H-v2', references: ['G2'] },
  ],
  succession: [
    { from: 'A', to: 'A', kind: 'RENUMBER' },
    { from: 'B', to: 'B', kind: 'RENUMBER' },
    { from: 'C', to: 'C', kind: 'RENUMBER' },
    { from: 'G', to: 'G2', kind: 'REPLACE' },
    { from: 'H', to: 'H', kind: 'RENUMBER' },
    { from: 'A', to: 'A2', kind: 'REPLACE' },
  ],
  bindings: [
    { ruleId: 'RULE-A', articleIds: ['A2'] },
    { ruleId: 'RULE-B', articleIds: ['B'] },
    { ruleId: 'RULE-C', articleIds: ['C'] },
    { ruleId: 'RULE-Z', articleIds: ['Z'] },
  ],
};

export const TIMEPOINT_BACKFILL_EDGE = {
  from: 'Z',
  to: 'C',
  kind: 'REPLACE' as const,
  recordedAt: '2027-06-15T00:00:00.000Z',
};

export const TIMEPOINTS = {
  draft: {
    queryAt: '2026-08-03T00:00:00.000Z',
    fromVersionId: 'LAW-V1',
    toVersionId: 'LAW-DRAFT-2',
  },
  publishedNotEffective: {
    queryAt: '2026-09-01T00:00:00.000Z',
    fromVersionId: 'LAW-V1',
    toVersionId: 'LAW-V2',
  },
  effective: {
    queryAt: '2027-02-01T00:00:00.000Z',
    fromVersionId: 'LAW-V1',
    toVersionId: 'LAW-V2',
  },
  postBackfill: {
    queryAt: '2027-07-01T00:00:00.000Z',
    fromVersionId: 'LAW-V1',
    toVersionId: 'LAW-V2',
  },
} as const;
