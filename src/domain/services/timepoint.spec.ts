import { GraphBuilder } from '../services/graph-builder';
import { ImpactAnalyzer } from '../services/impact-analyzer';
import { TimepointResolver } from '../services/timepoint-resolver';
import { EdgeSequenceBuilder } from '../services/edge-sequence-builder';
import {
  timelineGraphInput,
  timelineWithBackfillInput,
  vid,
  aid,
  rid,
} from '../testing/timeline-fixtures';
import { QueryPhase } from '../models/query-phase';
import { VersionStatus } from '../models/enums';
import {
  cycleGraphInput,
  sameDayVersionsGraphInput,
  draft2GraphInput,
} from '../testing/test-fixtures';

describe('TimepointResolver', () => {
  let resolver: TimepointResolver;
  let builder: GraphBuilder;

  beforeEach(() => {
    resolver = new TimepointResolver();
    builder = new GraphBuilder();
  });

  it('resolves DRAFT phase for a draft target version', () => {
    const graph = builder.build(timelineGraphInput());
    const tp = resolver.resolve(
      graph,
      vid('LAW-V1'),
      vid('LAW-DRAFT-2'),
      '2026-06-01T00:00:00.000Z',
      0,
    );
    expect(tp.phase).toBe(QueryPhase.DRAFT);
    expect(tp.targetVersion.declaredStatus).toBe(VersionStatus.DRAFT);
    expect(tp.targetVersion.effectiveAtQuery).toBe(false);
  });

  it('resolves PUBLISHED_NOT_EFFECTIVE for a published version before effective date', () => {
    const graph = builder.build(timelineGraphInput());
    const tp = resolver.resolve(
      graph,
      vid('LAW-V1'),
      vid('LAW-V2'),
      '2026-06-01T00:00:00.000Z',
      0,
    );
    expect(tp.phase).toBe(QueryPhase.PUBLISHED_NOT_EFFECTIVE);
    expect(tp.targetVersion.declaredStatus).toBe(VersionStatus.PUBLISHED);
    expect(tp.targetVersion.effectiveAtQuery).toBe(false);
  });

  it('resolves EFFECTIVE for a published version on or after effective date', () => {
    const graph = builder.build(timelineGraphInput());
    const tp = resolver.resolve(
      graph,
      vid('LAW-V1'),
      vid('LAW-V2'),
      '2027-06-01T00:00:00.000Z',
      0,
    );
    expect(tp.phase).toBe(QueryPhase.EFFECTIVE);
    expect(tp.targetVersion.effectiveAtQuery).toBe(true);
  });

  it('resolves POST_BACKFILL when backfillCount > 0 regardless of status', () => {
    const graph = builder.build(timelineWithBackfillInput());
    const tp = resolver.resolve(
      graph,
      vid('LAW-V1'),
      vid('LAW-V2'),
      '2027-06-01T00:00:00.000Z',
      1,
    );
    expect(tp.phase).toBe(QueryPhase.POST_BACKFILL);
    expect(tp.backfillCount).toBe(1);
  });

  it('binds source and target version IDs into the timepoint', () => {
    const graph = builder.build(timelineGraphInput());
    const tp = resolver.resolve(
      graph,
      vid('LAW-V1'),
      vid('LAW-V2'),
      '2027-06-01T00:00:00.000Z',
      0,
    );
    expect(tp.sourceVersion.versionId).toBe(vid('LAW-V1'));
    expect(tp.targetVersion.versionId).toBe(vid('LAW-V2'));
    expect(tp.asOf).toBe('2027-06-01T00:00:00.000Z');
  });
});

describe('EdgeSequenceBuilder', () => {
  let builder: GraphBuilder;
  let edgeBuilder: EdgeSequenceBuilder;

  beforeEach(() => {
    builder = new GraphBuilder();
    edgeBuilder = new EdgeSequenceBuilder();
  });

  it('produces a deterministic edge sequence hash', () => {
    const graph = builder.build(timelineGraphInput());
    const seq1 = edgeBuilder.build(graph);
    const seq2 = edgeBuilder.build(graph);
    expect(seq1.hash).toBe(seq2.hash);
    expect(seq1.entries.length).toBe(seq2.entries.length);
  });

  it('changes hash when a backfill edge is added', () => {
    const graphBefore = builder.build(timelineGraphInput());
    const graphAfter = builder.build(timelineWithBackfillInput());
    const seqBefore = edgeBuilder.build(graphBefore);
    const seqAfter = edgeBuilder.build(graphAfter);
    expect(seqBefore.hash).not.toBe(seqAfter.hash);
    expect(seqAfter.entries.length).toBeGreaterThan(
      seqBefore.entries.length,
    );
  });

  it('orders entries by edge kind, from, to', () => {
    const graph = builder.build(timelineGraphInput());
    const seq = edgeBuilder.build(graph);
    for (let i = 1; i < seq.entries.length; i++) {
      const prev = seq.entries[i - 1];
      const curr = seq.entries[i];
      if (prev.edgeKind === curr.edgeKind) {
        if (prev.fromId === curr.fromId) {
          expect(prev.toId.localeCompare(curr.toId)).toBeLessThanOrEqual(0);
        } else {
          expect(prev.fromId.localeCompare(curr.fromId)).toBeLessThanOrEqual(0);
        }
      } else {
        expect(prev.edgeKind.localeCompare(curr.edgeKind)).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe('Four timepoint queries', () => {
  let builder: GraphBuilder;
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    builder = new GraphBuilder();
    analyzer = new ImpactAnalyzer();
  });

  function analyze(
    input: ReturnType<typeof timelineGraphInput>,
    target: string,
    asOf: string,
    backfillCount = 0,
  ) {
    const graph = builder.build(input);
    return analyzer.analyze(
      graph,
      vid('LAW-V1'),
      vid(target),
      asOf,
      { asOf, backfillCount },
    );
  }

  it('timepoint 1 — draft period: phase DRAFT, missing T-D', () => {
    const report = analyze(
      timelineGraphInput(),
      'LAW-DRAFT-2',
      '2026-06-01T00:00:00.000Z',
    );
    expect(report.timepoint.phase).toBe(QueryPhase.DRAFT);
    expect(report.timepoint.asOf).toBe('2026-06-01T00:00:00.000Z');

    const missingIds = report.missingSuccessions.map((m) => m.stableId);
    expect(missingIds).toContain(aid('T-D'));
    expect(missingIds).toContain(aid('T-C'));

    const unaffectedRules = report.unaffectedRules.map(
      (r) => r.ruleId,
    );
    expect(unaffectedRules).toContain(rid('T-RULE-D'));
  });

  it('timepoint 2 — published not effective: phase PUBLISHED_NOT_EFFECTIVE', () => {
    const report = analyze(
      timelineGraphInput(),
      'LAW-V2',
      '2026-06-01T00:00:00.000Z',
    );
    expect(report.timepoint.phase).toBe(
      QueryPhase.PUBLISHED_NOT_EFFECTIVE,
    );
    expect(report.timepoint.targetVersion.effectiveAtQuery).toBe(false);

    const directIds = report.directArticles.map((a) => a.stableId);
    expect(directIds).toContain(aid('T-A'));
    expect(directIds).toContain(aid('T-B'));
    expect(directIds).toContain(aid('T-A1V2'));
    expect(directIds).toContain(aid('T-MV2'));

    const missingIds = report.missingSuccessions.map((m) => m.stableId);
    expect(missingIds).toContain(aid('T-D'));
  });

  it('timepoint 3 — after effective: phase EFFECTIVE, same impact set', () => {
    const report = analyze(
      timelineGraphInput(),
      'LAW-V2',
      '2027-06-01T00:00:00.000Z',
    );
    expect(report.timepoint.phase).toBe(QueryPhase.EFFECTIVE);
    expect(report.timepoint.targetVersion.effectiveAtQuery).toBe(true);

    const directIds = report.directArticles.map((a) => a.stableId).sort();
    const report2 = analyze(
      timelineGraphInput(),
      'LAW-V2',
      '2026-06-01T00:00:00.000Z',
    );
    const directIds2 = report2.directArticles
      .map((a) => a.stableId)
      .sort();
    expect(directIds).toEqual(directIds2);
  });

  it('timepoint 4 — after backfill: phase POST_BACKFILL, T-D no longer missing', () => {
    const before = analyze(
      timelineGraphInput(),
      'LAW-V2',
      '2027-06-01T00:00:00.000Z',
      0,
    );
    const after = analyze(
      timelineWithBackfillInput(),
      'LAW-V2',
      '2027-06-01T00:00:00.000Z',
      1,
    );

    expect(before.timepoint.phase).toBe(QueryPhase.EFFECTIVE);
    expect(after.timepoint.phase).toBe(QueryPhase.POST_BACKFILL);

    const beforeMissing = before.missingSuccessions.map(
      (m) => m.stableId,
    );
    const afterMissing = after.missingSuccessions.map(
      (m) => m.stableId,
    );
    expect(beforeMissing).toContain(aid('T-D'));
    expect(afterMissing).not.toContain(aid('T-D'));

    const afterDirect = after.directArticles.map((a) => a.stableId);
    expect(afterDirect).toContain(aid('T-D'));
    expect(afterDirect).toContain(aid('T-D1'));

    const afterDirectRules = after.directRules.map((r) => r.ruleId);
    expect(afterDirectRules).toContain(rid('T-RULE-D'));

    expect(before.edgeSequence.hash).not.toBe(
      after.edgeSequence.hash,
    );
    expect(before.graphFingerprint).not.toBe(
      after.graphFingerprint,
    );
  });

  it('each report binds graphFingerprint, edgeSequence hash and timepoint', () => {
    const report = analyze(
      timelineGraphInput(),
      'LAW-V2',
      '2027-06-01T00:00:00.000Z',
    );
    expect(report.graphFingerprint).toMatch(/^fp_[0-9a-f]+$/);
    expect(report.edgeSequence.hash).toMatch(/^es_[0-9a-f]+$/);
    expect(report.edgeSequence.entries.length).toBeGreaterThan(0);
    expect(report.timepoint.sourceVersion.versionId).toBe(
      vid('LAW-V1'),
    );
    expect(report.timepoint.targetVersion.versionId).toBe(
      vid('LAW-V2'),
    );
    expect(report.queriedAt).toBeDefined();
  });
});

describe('Backfill immutability — old snapshots do not drift', () => {
  let builder: GraphBuilder;
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    builder = new GraphBuilder();
    analyzer = new ImpactAnalyzer();
  });

  it('pre-backfill missing-edge diagnosis is byte-identical after backfill graph is loaded separately', () => {
    const graphBefore = builder.build(timelineGraphInput());
    const reportBefore = analyzer.analyze(
      graphBefore,
      vid('LAW-V1'),
      vid('LAW-V2'),
      '2027-06-01T00:00:00.000Z',
      { asOf: '2027-06-01T00:00:00.000Z', backfillCount: 0 },
    );

    const frozenBefore = JSON.stringify(reportBefore);

    const graphAfter = builder.build(timelineWithBackfillInput());
    const reportAfter = analyzer.analyze(
      graphAfter,
      vid('LAW-V1'),
      vid('LAW-V2'),
      '2027-06-01T00:00:00.000Z',
      { asOf: '2027-06-01T00:00:00.000Z', backfillCount: 1 },
    );

    expect(reportAfter.missingSuccessions.find(
      (m) => m.stableId === aid('T-D'),
    )).toBeUndefined();
    expect(reportBefore.missingSuccessions.find(
      (m) => m.stableId === aid('T-D'),
    )).toBeDefined();

    const replayedBefore = JSON.parse(frozenBefore) as typeof reportBefore;
    expect(replayedBefore.missingSuccessions).toEqual(
      reportBefore.missingSuccessions,
    );
    expect(replayedBefore.paths).toEqual(reportBefore.paths);
    expect(replayedBefore.graphFingerprint).toBe(
      reportBefore.graphFingerprint,
    );
    expect(replayedBefore.edgeSequence.hash).toBe(
      reportBefore.edgeSequence.hash,
    );
  });

  it('backfill changes fingerprint and edge hash but old report JSON remains intact', () => {
    const graphBefore = builder.build(timelineGraphInput());
    const beforeReport = analyzer.analyze(
      graphBefore,
      vid('LAW-V1'),
      vid('LAW-V2'),
      '2027-06-01T00:00:00.000Z',
    );
    const beforeSnapshot = JSON.stringify(beforeReport);

    const graphAfter = builder.build(timelineWithBackfillInput());
    const afterReport = analyzer.analyze(
      graphAfter,
      vid('LAW-V1'),
      vid('LAW-V2'),
      '2027-06-01T00:00:00.000Z',
      { backfillCount: 1 },
    );

    expect(beforeReport.graphFingerprint).not.toBe(
      afterReport.graphFingerprint,
    );
    expect(beforeReport.edgeSequence.hash).not.toBe(
      afterReport.edgeSequence.hash,
    );
    expect(beforeReport.timepoint.backfillCount).toBe(0);
    expect(afterReport.timepoint.backfillCount).toBe(1);

    const replayed = JSON.parse(beforeSnapshot);
    expect(replayed.graphFingerprint).toBe(
      beforeReport.graphFingerprint,
    );
    expect(replayed.timepoint.backfillCount).toBe(0);
  });
});

describe('Same-day multiple versions', () => {
  let builder: GraphBuilder;
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    builder = new GraphBuilder();
    analyzer = new ImpactAnalyzer();
  });

  it('distinguishes two target versions effective on the same day', () => {
    const graph = builder.build(sameDayVersionsGraphInput());
    const reportA = analyzer.analyze(
      graph,
      vid('V1'),
      vid('V2A'),
      '2027-01-01T12:00:00.000Z',
      { asOf: '2027-01-01T12:00:00.000Z' },
    );
    const reportB = analyzer.analyze(
      graph,
      vid('V1'),
      vid('V2B'),
      '2027-01-01T12:00:00.000Z',
      { asOf: '2027-01-01T12:00:00.000Z' },
    );

    expect(reportA.targetVersionId).toBe(vid('V2A'));
    expect(reportB.targetVersionId).toBe(vid('V2B'));
    expect(reportA.graphFingerprint).toBe(reportB.graphFingerprint);

    const aDirect = reportA.directArticles.map((a) => a.stableId);
    const bDirect = reportB.directArticles.map((a) => a.stableId);
    expect(aDirect).toContain(aid('D2A'));
    expect(bDirect).toContain(aid('D2B'));
    expect(aDirect).not.toEqual(bDirect);
  });

  it('byte-level identical results on repeated queries', () => {
    const graph = builder.build(sameDayVersionsGraphInput());
    const r1 = analyzer.analyze(
      graph,
      vid('V1'),
      vid('V2A'),
      '2027-01-01T12:00:00.000Z',
    );
    const r2 = analyzer.analyze(
      graph,
      vid('V1'),
      vid('V2A'),
      '2027-01-01T12:00:00.000Z',
    );
    const s1 = JSON.stringify({ ...r1, queriedAt: '' });
    const s2 = JSON.stringify({ ...r2, queriedAt: '' });
    expect(s1).toBe(s2);
  });
});

describe('Cross-reference cycle cache invalidation', () => {
  let builder: GraphBuilder;
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    builder = new GraphBuilder();
    analyzer = new ImpactAnalyzer();
  });

  it('terminates on cycles and produces stable results across runs', () => {
    const graph = builder.build(cycleGraphInput());
    const r1 = analyzer.analyze(
      graph,
      vid('V1'),
      vid('V2'),
      '2026-08-03T00:00:00.000Z',
    );
    const r2 = analyzer.analyze(
      graph,
      vid('V1'),
      vid('V2'),
      '2026-08-03T00:00:00.000Z',
    );

    expect(r1.paths.length).toBeGreaterThan(0);
    expect(r1.paths.length).toBeLessThan(1000);

    for (const p of r1.paths) {
      const ids = p.hops.map((h) => h.toId);
      expect(new Set(ids).size).toBe(ids.length);
    }

    expect(JSON.stringify({ ...r1, queriedAt: '' })).toBe(
      JSON.stringify({ ...r2, queriedAt: '' }),
    );
  });

  it('cache invalidation: adding a cross-reference changes edge sequence and paths', () => {
    const graphBefore = builder.build(cycleGraphInput());
    const beforeReport = analyzer.analyze(
      graphBefore,
      vid('V1'),
      vid('V2'),
      '2026-08-03T00:00:00.000Z',
    );

    const cycleWithExtraRef = {
      ...cycleGraphInput(),
      articles: cycleGraphInput().articles.map((a) =>
        a.stableId === aid('N1')
          ? { ...a, references: [aid('C1')] }
          : a,
      ),
    };
    const graphAfter = builder.build(cycleWithExtraRef);
    const afterReport = analyzer.analyze(
      graphAfter,
      vid('V1'),
      vid('V2'),
      '2026-08-03T00:00:00.000Z',
    );

    expect(beforeReport.edgeSequence.hash).not.toBe(
      afterReport.edgeSequence.hash,
    );
    expect(beforeReport.graphFingerprint).not.toBe(
      afterReport.graphFingerprint,
    );
  });
});

describe('DRAFT-2 timepoint binding', () => {
  let builder: GraphBuilder;
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    builder = new GraphBuilder();
    analyzer = new ImpactAnalyzer();
  });

  it('binds timepoint, edge sequence and fingerprint for DRAFT-2 query', () => {
    const graph = builder.build(draft2GraphInput());
    const report = analyzer.analyze(
      graph,
      vid('LAW-V1'),
      vid('LAW-DRAFT-2'),
      '2026-08-03T10:00:00.000Z',
      { asOf: '2026-08-03T10:00:00.000Z' },
    );

    expect(report.timepoint.phase).toBe(QueryPhase.DRAFT);
    expect(report.timepoint.targetVersion.versionId).toBe(
      vid('LAW-DRAFT-2'),
    );
    expect(report.edgeSequence.hash).toMatch(/^es_/);
    expect(report.graphFingerprint).toMatch(/^fp_/);
    expect(report.ruleWitnesses.length).toBeGreaterThan(0);
  });
});
