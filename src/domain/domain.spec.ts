import {
  buildGraph,
  computeImpact,
  createSnapshot,
  makeArticleKey,
  replaySnapshot,
  type ArticleInput,
  type BindingInput,
  type ImpactQuery,
  type SuccessionInput,
  type VersionInput,
} from './index';

const sampleVersions: VersionInput[] = [
  { id: 'V1', status: 'EFFECTIVE', effectiveFrom: '2026-01-01' },
  { id: 'V2', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
];

function key(stable: string, ver: string): string {
  return makeArticleKey(stable, ver);
}

describe('impact propagation (pure domain)', () => {
  it('material fixture: split ART-A into ART-A1/A2 with reference from ART-B', () => {
    const articles: ArticleInput[] = [
      { stableId: 'ART-A', version: 'V1', label: '第十条' },
      { stableId: 'ART-B', version: 'V1', label: '第十一条', references: ['ART-A'] },
      { stableId: 'ART-A1', version: 'V2', label: '第十二条' },
      { stableId: 'ART-A2', version: 'V2', label: '第十三条' },
    ];
    const succession: SuccessionInput[] = [
      { from: 'ART-A', to: ['ART-A1', 'ART-A2'], kind: 'SPLIT' },
    ];
    const bindings: BindingInput[] = [
      { ruleId: 'RULE-ELIGIBILITY-01', articleIds: ['ART-A'] },
      { ruleId: 'RULE-SERVICE-02', articleIds: ['ART-B'] },
    ];
    const g = buildGraph(sampleVersions, articles, succession, bindings);
    const q: ImpactQuery = {
      fromVersionId: 'V1',
      toVersionId: 'V2',
      queryAt: '2026-08-01T00:00:00.000Z',
    };
    const r = computeImpact(g, q);

    expect(r.directKeys).toEqual(
      expect.arrayContaining([
        key('ART-A', 'V1'),
        key('ART-A1', 'V2'),
        key('ART-A2', 'V2'),
      ]),
    );
    expect(r.indirectKeys).toContain(key('ART-B', 'V1'));
    expect(r.unaffectedKeys).toHaveLength(0);

    const eligibility = r.rules.find((x) => x.ruleId === 'RULE-ELIGIBILITY-01');
    expect(eligibility?.level).toBe('DIRECT');
    const service = r.rules.find((x) => x.ruleId === 'RULE-SERVICE-02');
    expect(service?.level).toBe('INDIRECT');
  });

  it('handles one-to-many split with both descendants DIRECT', () => {
    const articles: ArticleInput[] = [
      { stableId: 'A', version: 'V1', label: 'a' },
      { stableId: 'A1', version: 'V2', label: 'a1' },
      { stableId: 'A2', version: 'V2', label: 'a2' },
      { stableId: 'A3', version: 'V2', label: 'a3' },
    ];
    const succession: SuccessionInput[] = [
      { from: 'A', to: ['A1', 'A2', 'A3'], kind: 'SPLIT' },
    ];
    const g = buildGraph(sampleVersions, articles, succession, []);
    const r = computeImpact(g, {
      fromVersionId: 'V1',
      toVersionId: 'V2',
      queryAt: '2026-08-01T00:00:00.000Z',
    });
    expect(r.directKeys).toEqual(
      expect.arrayContaining([
        key('A', 'V1'),
        key('A1', 'V2'),
        key('A2', 'V2'),
        key('A3', 'V2'),
      ]),
    );
  });

  it('handles many-to-one merge with all ancestors DIRECT', () => {
    const articles: ArticleInput[] = [
      { stableId: 'A', version: 'V1', label: 'a' },
      { stableId: 'B', version: 'V1', label: 'b' },
      { stableId: 'C', version: 'V1', label: 'c' },
      { stableId: 'M', version: 'V2', label: 'merged' },
    ];
    const succession: SuccessionInput[] = [
      { from: ['A', 'B', 'C'], to: 'M', kind: 'MERGE' },
    ];
    const g = buildGraph(sampleVersions, articles, succession, []);
    const r = computeImpact(g, {
      fromVersionId: 'V1',
      toVersionId: 'V2',
      queryAt: '2026-08-01T00:00:00.000Z',
    });
    expect(r.directKeys).toEqual(
      expect.arrayContaining([
        key('A', 'V1'),
        key('B', 'V1'),
        key('C', 'V1'),
        key('M', 'V2'),
      ]),
    );
  });

  it('tolerates reference cycles without infinite loop', () => {
    const articles: ArticleInput[] = [
      { stableId: 'A', version: 'V1', label: 'a', references: ['B'] },
      { stableId: 'B', version: 'V1', label: 'b', references: ['C'] },
      { stableId: 'C', version: 'V1', label: 'c', references: ['A'] },
      { stableId: 'A2', version: 'V2', label: 'a2' },
    ];
    const succession: SuccessionInput[] = [
      { from: 'A', to: 'A2', kind: 'REPLACE' },
    ];
    const g = buildGraph(sampleVersions, articles, succession, []);
    const r = computeImpact(g, {
      fromVersionId: 'V1',
      toVersionId: 'V2',
      queryAt: '2026-08-01T00:00:00.000Z',
    });
    expect(r.indirectKeys).toEqual(
      expect.arrayContaining([key('B', 'V1'), key('C', 'V1')]),
    );
    const pathsForB = r.articles.find((a) => a.key === key('B', 'V1'))?.paths;
    expect(pathsForB?.[0]?.nodes).toContain(key('A', 'V1'));
  });

  it('reports missing succession rather than guessing', () => {
    const articles: ArticleInput[] = [
      { stableId: 'A', version: 'V1', label: 'a' },
      { stableId: 'B', version: 'V1', label: 'b' },
      { stableId: 'A2', version: 'V2', label: 'a2' },
      { stableId: 'C2', version: 'V2', label: 'c2' },
    ];
    const succession: SuccessionInput[] = [
      { from: 'A', to: 'A2', kind: 'REPLACE' },
    ];
    const g = buildGraph(sampleVersions, articles, succession, []);
    const r = computeImpact(g, {
      fromVersionId: 'V1',
      toVersionId: 'V2',
      queryAt: '2026-08-01T00:00:00.000Z',
    });
    const stableIds = r.missingSuccession.map((m) => m.stableId);
    expect(stableIds).toContain('B');
    expect(stableIds).toContain('C2');
    expect(r.directKeys).not.toContain(key('B', 'V1'));
    expect(r.directKeys).not.toContain(key('C2', 'V2'));
  });

  it('paths are stable and deduplicated across repeated runs', () => {
    const articles: ArticleInput[] = [
      { stableId: 'A', version: 'V1', label: 'a' },
      { stableId: 'B', version: 'V1', label: 'b', references: ['A'] },
      { stableId: 'C', version: 'V1', label: 'c', references: ['A'] },
      { stableId: 'D', version: 'V1', label: 'd', references: ['B'] },
      { stableId: 'A2', version: 'V2', label: 'a2' },
    ];
    const succession: SuccessionInput[] = [
      { from: 'A', to: 'A2', kind: 'REPLACE' },
    ];
    const g = buildGraph(sampleVersions, articles, succession, []);
    const q: ImpactQuery = {
      fromVersionId: 'V1',
      toVersionId: 'V2',
      queryAt: '2026-08-01T00:00:00.000Z',
    };
    const r1 = computeImpact(g, q);
    const r2 = computeImpact(g, q);
    expect(JSON.stringify(r1.articles)).toEqual(JSON.stringify(r2.articles));

    for (const a of r1.articles) {
      const keys = a.paths.map((p) => p.nodes.join('>'));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('large graph: paths deduplicate and sort deterministically', () => {
    const versions: VersionInput[] = [
      { id: 'V1', status: 'EFFECTIVE', effectiveFrom: '2026-01-01' },
      { id: 'V2', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
    ];
    const articles: ArticleInput[] = [];
    for (let i = 0; i < 80; i++) {
      articles.push({
        stableId: `N${i}`,
        version: 'V1',
        label: `n${i}`,
        references: i > 0 ? [`N${i - 1}`] : [],
      });
    }
    articles.push({ stableId: 'N0-2', version: 'V2', label: 'next' });
    const succession: SuccessionInput[] = [
      { from: 'N0', to: 'N0-2', kind: 'REPLACE' },
    ];
    const g = buildGraph(versions, articles, succession, []);
    const r = computeImpact(
      g,
      {
        fromVersionId: 'V1',
        toVersionId: 'V2',
        queryAt: '2026-08-01T00:00:00.000Z',
      },
      { maxPathsPerTarget: 4 },
    );
    for (const a of r.articles) {
      if (a.level === 'UNAFFECTED') continue;
      for (let i = 1; i < a.paths.length; i++) {
        const prev = a.paths[i - 1];
        const cur = a.paths[i];
        if (prev.length !== cur.length) {
          expect(prev.length).toBeLessThanOrEqual(cur.length);
        } else {
          expect(prev.nodes.join('>') <= cur.nodes.join('>')).toBe(true);
        }
      }
    }
  });

  it('snapshot is immutable and replay yields the same result', () => {
    const articles: ArticleInput[] = [
      { stableId: 'A', version: 'V1', label: 'a' },
      { stableId: 'A2', version: 'V2', label: 'a2' },
    ];
    const succession: SuccessionInput[] = [
      { from: 'A', to: 'A2', kind: 'RENUMBER' },
    ];
    const g = buildGraph(sampleVersions, articles, succession, []);
    const q: ImpactQuery = {
      fromVersionId: 'V1',
      toVersionId: 'V2',
      queryAt: '2026-08-01T00:00:00.000Z',
    };
    const snap = createSnapshot({ graph: g, query: q, createdAt: '2026-08-01T12:00:00.000Z' });
    expect(Object.isFrozen(snap)).toBe(true);
    const replay = replaySnapshot(snap);
    expect(JSON.stringify(replay.articles)).toEqual(
      JSON.stringify(snap.result.articles),
    );
    expect(replay.directKeys).toEqual(snap.result.directKeys);
  });

  it('snapshot replayed after adding new edges still yields original result', () => {
    const articles1: ArticleInput[] = [
      { stableId: 'A', version: 'V1', label: 'a' },
      { stableId: 'A2', version: 'V2', label: 'a2' },
    ];
    const succession1: SuccessionInput[] = [
      { from: 'A', to: 'A2', kind: 'REPLACE' },
    ];
    const g1 = buildGraph(sampleVersions, articles1, succession1, []);
    const q: ImpactQuery = {
      fromVersionId: 'V1',
      toVersionId: 'V2',
      queryAt: '2026-08-01T00:00:00.000Z',
    };
    const snap = createSnapshot({ graph: g1, query: q });
    const originalDirect = [...snap.result.directKeys];

    const articles2: ArticleInput[] = [
      ...articles1,
      { stableId: 'B', version: 'V1', label: 'b', references: ['A'] },
    ];
    const g2 = buildGraph(sampleVersions, articles2, succession1, []);
    const r2 = computeImpact(g2, q);
    expect(r2.indirectKeys).toContain(key('B', 'V1'));

    const replay = replaySnapshot(snap);
    expect(replay.indirectKeys).not.toContain(key('B', 'V1'));
    expect(replay.directKeys).toEqual(originalDirect);
  });

  it('does not guess identity from labels or text', () => {
    const articles: ArticleInput[] = [
      { stableId: 'A', version: 'V1', label: 'SAME-LABEL' },
      { stableId: 'X', version: 'V2', label: 'SAME-LABEL' },
    ];
    const g = buildGraph(sampleVersions, articles, [], []);
    const r = computeImpact(g, {
      fromVersionId: 'V1',
      toVersionId: 'V2',
      queryAt: '2026-08-01T00:00:00.000Z',
    });
    expect(r.directKeys).toEqual([]);
    expect(r.missingSuccession.map((m) => m.stableId).sort()).toEqual(
      ['A', 'X'].sort(),
    );
  });
});

describe('input normalization', () => {
  it('orders versions with same effective date by status then id deterministically', () => {
    const versions: VersionInput[] = [
      { id: 'VZ', status: 'DRAFT', effectiveFrom: '2027-01-01' },
      { id: 'VA', status: 'EFFECTIVE', effectiveFrom: '2027-01-01' },
      { id: 'VM', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
    ];
    const articles: ArticleInput[] = [];
    const g = buildGraph(versions, articles, [], []);
    expect(g.versionOrder).toEqual(['VZ', 'VM', 'VA']);
  });
});
