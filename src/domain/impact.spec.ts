import { canonicalStringify } from '../common/canonical-json';
import { computeImpact, UnknownVersionError } from './impact';
import type { ImpactQuery, RevisionGraph } from './types';

const QUERY: ImpactQuery = {
  fromVersion: 'V1',
  toVersion: 'V2',
  asOf: '2026-08-02T00:00:00.000Z',
};

function baseGraph(): RevisionGraph {
  return {
    versions: [
      { id: 'V1', status: 'EFFECTIVE', effectiveFrom: '2026-01-01' },
      { id: 'V2', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
    ],
    articles: [],
    references: [],
    succession: [],
    bindings: [],
  };
}

describe('computeImpact', () => {
  it('handles the material split: one article splits into many, citing rule is indirect', () => {
    const graph: RevisionGraph = {
      ...baseGraph(),
      articles: [
        { stableId: 'ART-A', versionId: 'V1', label: '第十条' },
        { stableId: 'ART-B', versionId: 'V1', label: '第十一条' },
        { stableId: 'ART-A1', versionId: 'V2', label: '第十二条' },
        { stableId: 'ART-A2', versionId: 'V2', label: '第十三条' },
      ],
      references: [{ versionId: 'V1', fromId: 'ART-B', toId: 'ART-A' }],
      succession: [
        { fromId: 'ART-A', toId: 'ART-A1', kind: 'SPLIT' },
        { fromId: 'ART-A', toId: 'ART-A2', kind: 'SPLIT' },
      ],
      bindings: [
        { ruleId: 'RULE-ELIGIBILITY-01', articleId: 'ART-A' },
        { ruleId: 'RULE-SERVICE-02', articleId: 'ART-B' },
      ],
    };
    const result = computeImpact(graph, QUERY);
    expect(result.changedArticles.map((c) => c.stableId)).toEqual(['ART-A']);
    expect(result.changedArticles[0]?.succession.map((e) => e.toId)).toEqual([
      'ART-A1',
      'ART-A2',
    ]);
    expect(result.rules.direct.map((r) => r.ruleId)).toEqual([
      'RULE-ELIGIBILITY-01',
    ]);
    expect(result.rules.indirect.map((r) => r.ruleId)).toEqual([
      'RULE-SERVICE-02',
    ]);
    expect(result.rules.unaffected).toEqual([]);
    expect(result.missingSuccession).toEqual([
      { stableId: 'ART-B', boundRuleIds: ['RULE-SERVICE-02'] },
    ]);
    const indirectPaths = result.paths.filter((p) => p.impact === 'INDIRECT');
    expect(indirectPaths).toHaveLength(1);
    expect(indirectPaths[0]?.nodes).toEqual(['ART-A', 'ART-B']);
    expect(indirectPaths[0]?.edges).toEqual([
      { fromId: 'ART-A', toId: 'ART-B', kind: 'REFERENCE_REVERSE' },
    ]);
    const directPaths = result.paths.filter((p) => p.impact === 'DIRECT');
    expect(directPaths.map((p) => p.nodes)).toEqual([['ART-A']]);
    expect(result.traversedEdges).toContainEqual({
      fromId: 'ART-A',
      toId: 'ART-A1',
      kind: 'SUCCESSION',
    });
    expect(result.traversedEdges).toContainEqual({
      fromId: 'ART-A',
      toId: 'ART-B',
      kind: 'REFERENCE_REVERSE',
    });
  });

  it('handles many-to-one merges: all merged articles are direct change sources', () => {
    const graph: RevisionGraph = {
      ...baseGraph(),
      articles: [
        { stableId: 'ART-X', versionId: 'V1', label: '第二十条' },
        { stableId: 'ART-Y', versionId: 'V1', label: '第二十一条' },
        { stableId: 'ART-Z', versionId: 'V2', label: '第二十二条' },
        { stableId: 'ART-W', versionId: 'V1', label: '第二十三条' },
        { stableId: 'ART-W', versionId: 'V2', label: '第二十三条' },
      ],
      references: [{ versionId: 'V1', fromId: 'ART-W', toId: 'ART-Y' }],
      succession: [
        { fromId: 'ART-X', toId: 'ART-Z', kind: 'MERGE' },
        { fromId: 'ART-Y', toId: 'ART-Z', kind: 'MERGE' },
      ],
      bindings: [
        { ruleId: 'RULE-X', articleId: 'ART-X' },
        { ruleId: 'RULE-Y', articleId: 'ART-Y' },
        { ruleId: 'RULE-W', articleId: 'ART-W' },
      ],
    };
    const result = computeImpact(graph, QUERY);
    expect(result.rules.direct.map((r) => r.ruleId)).toEqual(['RULE-X', 'RULE-Y']);
    expect(result.rules.indirect.map((r) => r.ruleId)).toEqual(['RULE-W']);
    expect(result.unchangedArticles).toEqual(['ART-W']);
    expect(result.missingSuccession).toEqual([]);
    expect(result.paths.find((p) => p.ruleId === 'RULE-W')?.nodes).toEqual([
      'ART-Y',
      'ART-W',
    ]);
  });

  it('terminates on cross-reference cycles and reports each article once', () => {
    const graph: RevisionGraph = {
      ...baseGraph(),
      articles: [
        { stableId: 'ART-A', versionId: 'V1', label: 'A' },
        { stableId: 'ART-B', versionId: 'V1', label: 'B' },
        { stableId: 'ART-C', versionId: 'V1', label: 'C' },
        { stableId: 'ART-A2', versionId: 'V2', label: 'A2' },
      ],
      references: [
        { versionId: 'V1', fromId: 'ART-A', toId: 'ART-B' },
        { versionId: 'V1', fromId: 'ART-B', toId: 'ART-C' },
        { versionId: 'V1', fromId: 'ART-C', toId: 'ART-A' },
      ],
      succession: [{ fromId: 'ART-A', toId: 'ART-A2', kind: 'RENUMBER' }],
      bindings: [
        { ruleId: 'RULE-B', articleId: 'ART-B' },
        { ruleId: 'RULE-C', articleId: 'ART-C' },
      ],
    };
    const result = computeImpact(graph, QUERY);
    expect(result.rules.direct).toEqual([]);
    expect(result.rules.indirect.map((r) => r.ruleId)).toEqual(['RULE-B', 'RULE-C']);
    expect(
      result.paths.filter((p) => p.ruleId === 'RULE-C').map((p) => p.nodes),
    ).toEqual([['ART-A', 'ART-C']]);
    expect(
      result.paths.filter((p) => p.ruleId === 'RULE-B').map((p) => p.nodes),
    ).toEqual([['ART-A', 'ART-C', 'ART-B']]);
  });

  it('reports missing succession instead of guessing identity from identical labels', () => {
    const graph: RevisionGraph = {
      ...baseGraph(),
      articles: [
        { stableId: 'ART-OLD', versionId: 'V1', label: '第三十条' },
        { stableId: 'ART-NEW', versionId: 'V2', label: '第三十条' },
        { stableId: 'ART-KEEP', versionId: 'V1', label: '第三十一条' },
        { stableId: 'ART-KEEP', versionId: 'V2', label: '第三十一条' },
      ],
      references: [],
      succession: [],
      bindings: [
        { ruleId: 'RULE-OLD', articleId: 'ART-OLD' },
        { ruleId: 'RULE-KEEP', articleId: 'ART-KEEP' },
      ],
    };
    const result = computeImpact(graph, QUERY);
    expect(result.missingSuccession).toEqual([
      { stableId: 'ART-OLD', boundRuleIds: ['RULE-OLD'] },
    ]);
    expect(result.addedArticles).toEqual(['ART-NEW']);
    expect(result.unchangedArticles).toEqual(['ART-KEEP']);
    expect(result.changedArticles).toEqual([]);
    expect(result.rules.direct).toEqual([]);
    expect(result.rules.indirect).toEqual([]);
    expect(result.rules.unaffected.map((r) => r.ruleId)).toEqual([
      'RULE-KEEP',
      'RULE-OLD',
    ]);
  });

  it('keeps same-day versions with distinct statuses distinct in the query context', () => {
    const graph: RevisionGraph = {
      versions: [
        { id: 'V-DRAFT', status: 'DRAFT', effectiveFrom: null },
        { id: 'V-PUB', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
        { id: 'V-PUB-2', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
      ],
      articles: [
        { stableId: 'ART-A', versionId: 'V-PUB', label: '第十条' },
        { stableId: 'ART-A', versionId: 'V-PUB-2', label: '第十条' },
      ],
      references: [],
      succession: [],
      bindings: [],
    };
    const published = computeImpact(graph, {
      ...QUERY,
      fromVersion: 'V-PUB',
      toVersion: 'V-PUB-2',
    });
    expect(published.versionContext.from.status).toBe('PUBLISHED');
    expect(published.versionContext.to.status).toBe('PUBLISHED');
    expect(published.versionContext.from.effectivenessAtAsOf).toBe(
      'NOT_YET_EFFECTIVE',
    );
    expect(published.versionContext.to.effectivenessAtAsOf).toBe(
      'NOT_YET_EFFECTIVE',
    );
    expect(published.unchangedArticles).toEqual(['ART-A']);

    const effective = computeImpact(graph, {
      ...QUERY,
      asOf: '2027-01-01T00:00:00.000Z',
      fromVersion: 'V-PUB',
      toVersion: 'V-PUB-2',
    });
    expect(effective.versionContext.to.effectivenessAtAsOf).toBe('EFFECTIVE');

    const draft = computeImpact(graph, {
      ...QUERY,
      fromVersion: 'V-PUB',
      toVersion: 'V-DRAFT',
    });
    expect(draft.versionContext.to.status).toBe('DRAFT');
    expect(draft.versionContext.to.effectiveFrom).toBeNull();
    expect(draft.missingSuccession.map((m) => m.stableId)).toEqual(['ART-A']);
  });

  it('is deterministic regardless of input ordering', () => {
    const graph: RevisionGraph = {
      ...baseGraph(),
      articles: [
        { stableId: 'N01', versionId: 'V1', label: 'N01' },
        { stableId: 'N02', versionId: 'V1', label: 'N02' },
        { stableId: 'N03', versionId: 'V1', label: 'N03' },
        { stableId: 'N04', versionId: 'V1', label: 'N04' },
        { stableId: 'N05', versionId: 'V1', label: 'N05' },
        { stableId: 'N06', versionId: 'V1', label: 'N06' },
        { stableId: 'N01-NEXT', versionId: 'V2', label: 'next' },
      ],
      references: [
        { versionId: 'V1', fromId: 'N02', toId: 'N01' },
        { versionId: 'V1', fromId: 'N03', toId: 'N01' },
        { versionId: 'V1', fromId: 'N03', toId: 'N02' },
        { versionId: 'V1', fromId: 'N04', toId: 'N02' },
        { versionId: 'V1', fromId: 'N04', toId: 'N03' },
        { versionId: 'V1', fromId: 'N05', toId: 'N04' },
      ],
      succession: [{ fromId: 'N01', toId: 'N01-NEXT', kind: 'RENUMBER' }],
      bindings: [
        { ruleId: 'R-5', articleId: 'N05' },
        { ruleId: 'R-3', articleId: 'N03' },
        { ruleId: 'R-4', articleId: 'N04' },
        { ruleId: 'R-6', articleId: 'N06' },
      ],
    };
    const shuffled: RevisionGraph = {
      versions: [...graph.versions].reverse(),
      articles: [...graph.articles].reverse(),
      references: [...graph.references].reverse(),
      succession: [...graph.succession].reverse(),
      bindings: [...graph.bindings].reverse(),
    };
    const first = computeImpact(graph, QUERY);
    const second = computeImpact(shuffled, QUERY);
    expect(canonicalStringify(second)).toEqual(canonicalStringify(first));

    const r4 = first.paths.filter((p) => p.ruleId === 'R-4');
    expect(r4.map((p) => p.nodes.join('>'))).toEqual([
      'N01>N02>N03>N04',
      'N01>N02>N04',
      'N01>N03>N04',
    ]);
    const r5 = first.paths.filter((p) => p.ruleId === 'R-5');
    expect(r5.map((p) => p.nodes.join('>'))).toEqual([
      'N01>N02>N03>N04>N05',
      'N01>N02>N04>N05',
      'N01>N03>N04>N05',
    ]);
    const r3 = first.paths.filter((p) => p.ruleId === 'R-3');
    expect(r3.map((p) => p.nodes.join('>'))).toEqual(['N01>N02>N03', 'N01>N03']);
    expect(first.rules.unaffected.map((r) => r.ruleId)).toEqual(['R-6']);
  });

  it('scales on a larger layered graph with deduplicated, stably sorted paths', () => {
    const width = 12;
    const articles = [
      { stableId: 'SRC', versionId: 'V1', label: 'src' },
      ...Array.from({ length: width }, (_, i) => ({
        stableId: `L1-${String(i).padStart(2, '0')}`,
        versionId: 'V1',
        label: `l1-${i}`,
      })),
      { stableId: 'SINK', versionId: 'V1', label: 'sink' },
      { stableId: 'SRC-2', versionId: 'V2', label: 'src2' },
    ];
    const references = [
      ...Array.from({ length: width }, (_, i) => ({
        versionId: 'V1',
        fromId: `L1-${String(i).padStart(2, '0')}`,
        toId: 'SRC',
      })),
      ...Array.from({ length: width }, (_, i) => ({
        versionId: 'V1',
        fromId: 'SINK',
        toId: `L1-${String(i).padStart(2, '0')}`,
      })),
    ];
    const graph: RevisionGraph = {
      ...baseGraph(),
      articles,
      references,
      succession: [{ fromId: 'SRC', toId: 'SRC-2', kind: 'RENUMBER' }],
      bindings: [{ ruleId: 'RULE-SINK', articleId: 'SINK' }],
    };
    const result = computeImpact(graph, QUERY);
    const sinkPaths = result.paths.filter((p) => p.ruleId === 'RULE-SINK');
    expect(sinkPaths).toHaveLength(width);
    const keys = sinkPaths.map((p) => p.nodes.join('>'));
    expect(new Set(keys).size).toBe(width);
    expect(keys).toEqual([...keys].sort());
    expect(result.rules.indirect.map((r) => r.ruleId)).toEqual(['RULE-SINK']);
  });

  it('throws UnknownVersionError for unknown versions', () => {
    expect(() =>
      computeImpact(baseGraph(), { ...QUERY, fromVersion: 'NOPE' }),
    ).toThrow(UnknownVersionError);
  });
});
