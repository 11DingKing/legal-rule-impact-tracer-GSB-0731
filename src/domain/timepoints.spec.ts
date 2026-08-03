import {
  buildGraph,
  computeImpact,
  type ImpactQuery,
  type RevisionGraphInput,
} from './index';
import {
  TIMEPOINT_BASE_FIXTURE,
  TIMEPOINT_BACKFILL_EDGE,
  TIMEPOINTS,
} from './fixtures/timepoints.fixture';

function run(fixture: RevisionGraphInput, query: ImpactQuery) {
  const g = buildGraph(
    fixture.versions,
    fixture.articles,
    fixture.succession,
    fixture.bindings,
  );
  return computeImpact(g, query);
}

function withBackfill(input: RevisionGraphInput): RevisionGraphInput {
  return {
    ...input,
    succession: [...input.succession, TIMEPOINT_BACKFILL_EDGE],
  };
}

describe('four timepoints with cross-references and backfill', () => {
  it('binds version ids, queryAt, graph hash and propagation edge sequence into context', () => {
    const r = run(TIMEPOINT_BASE_FIXTURE, TIMEPOINTS.effective);
    expect(r.context.fromVersionId).toBe('LAW-V1');
    expect(r.context.toVersionId).toBe('LAW-V2');
    expect(r.context.queryAt).toBe(TIMEPOINTS.effective.queryAt);
    expect(r.context.graphHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.context.propagationEdgeSequence.length).toBeGreaterThan(0);
    for (const e of r.context.propagationEdgeSequence) {
      expect(e.recordedAt).toBeTruthy();
    }
    const resolution = Object.fromEntries(
      r.context.versionResolutions.map((v) => [v.id, v]),
    );
    expect(resolution['LAW-V1'].effectiveAtQuery).toBe(true);
    expect(resolution['LAW-V1'].resolvedStatus).toBe('EFFECTIVE');
    expect(resolution['LAW-V2'].effectiveAtQuery).toBe(true);
    expect(resolution['LAW-V2'].resolvedStatus).toBe('EFFECTIVE');
  });

  it('draft-period query targets LAW-DRAFT-2 and keeps LAW-V2 unpublished', () => {
    const r = run(TIMEPOINT_BASE_FIXTURE, TIMEPOINTS.draft);
    expect(r.context.toVersionId).toBe('LAW-DRAFT-2');
    const v2 = r.context.versionResolutions.find((v) => v.id === 'LAW-V2');
    expect(v2?.effectiveAtQuery).toBe(false);
    expect(v2?.resolvedStatus).toBe('PUBLISHED');
    expect(r.directKeys.some((k) => k.endsWith('@LAW-V2'))).toBe(false);
  });

  it('published-not-effective query sees V2 as PUBLISHED (not EFFECTIVE)', () => {
    const r = run(
      TIMEPOINT_BASE_FIXTURE,
      TIMEPOINTS.publishedNotEffective,
    );
    const v2 = r.context.versionResolutions.find((v) => v.id === 'LAW-V2');
    expect(v2?.effectiveAtQuery).toBe(false);
    expect(v2?.resolvedStatus).toBe('PUBLISHED');
  });

  it('effective query sees V2 as EFFECTIVE', () => {
    const r = run(TIMEPOINT_BASE_FIXTURE, TIMEPOINTS.effective);
    const v2 = r.context.versionResolutions.find((v) => v.id === 'LAW-V2');
    expect(v2?.effectiveAtQuery).toBe(true);
    expect(v2?.resolvedStatus).toBe('EFFECTIVE');
  });

  it('effective-vs-published results differ in their context hash even though edges are visible', () => {
    const a = run(TIMEPOINT_BASE_FIXTURE, TIMEPOINTS.publishedNotEffective);
    const b = run(TIMEPOINT_BASE_FIXTURE, TIMEPOINTS.effective);
    expect(a.context.graphHash).not.toBe(b.context.graphHash);
    expect(a.context.versionResolutions).not.toEqual(b.context.versionResolutions);
  });

  it('before backfill, Z is missing succession and RULE-Z is unaffected', () => {
    const r = run(TIMEPOINT_BASE_FIXTURE, TIMEPOINTS.effective);
    expect(r.missingSuccession).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stableId: 'Z' }),
      ]),
    );
    const zRule = r.rules.find((x) => x.ruleId === 'RULE-Z');
    expect(zRule?.level).toBe('UNAFFECTED');
    expect(zRule?.shortestWitness).toBeNull();
    expect(zRule?.equalLengthWitnessCount).toBe(0);
  });

  it('after backfill, Z is connected at post-backfill time and RULE-Z becomes impacted', () => {
    const before = run(TIMEPOINT_BASE_FIXTURE, TIMEPOINTS.postBackfill);
    const after = run(withBackfill(TIMEPOINT_BASE_FIXTURE), TIMEPOINTS.postBackfill);
    expect(before.missingSuccession).toEqual(
      expect.arrayContaining([expect.objectContaining({ stableId: 'Z' })]),
    );
    expect(after.missingSuccession).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ stableId: 'Z' })]),
    );
    const zRuleAfter = after.rules.find((x) => x.ruleId === 'RULE-Z');
    expect(zRuleAfter?.level).not.toBe('UNAFFECTED');
    expect(after.context.graphHash).not.toBe(before.context.graphHash);
    expect(after.context.suppressedBackfillCount).toBe(0);
  });

  it('backfilled edge is suppressed for earlier queryAt moments (cannot rewrite history)', () => {
    const withEdge = withBackfill(TIMEPOINT_BASE_FIXTURE);
    const r = run(withEdge, TIMEPOINTS.effective);
    expect(r.context.suppressedBackfillCount).toBeGreaterThan(0);
    expect(r.missingSuccession).toEqual(
      expect.arrayContaining([expect.objectContaining({ stableId: 'Z' })]),
    );
    const zRule = r.rules.find((x) => x.ruleId === 'RULE-Z');
    expect(zRule?.level).toBe('UNAFFECTED');
    for (const e of r.context.propagationEdgeSequence) {
      if (e.kind === 'SUCCESSION') {
        expect(e.recordedAt <= TIMEPOINTS.effective.queryAt).toBe(true);
      }
    }
  });

  it('cross-reference G<->H cycle is traversed without infinite loop', () => {
    const r = run(TIMEPOINT_BASE_FIXTURE, TIMEPOINTS.draft);
    expect(r.directKeys).toEqual(
      expect.arrayContaining([
        'G@LAW-V1',
        'G2@LAW-DRAFT-2',
        'H@LAW-V1',
        'H@LAW-DRAFT-2',
      ]),
    );
    expect(r.truncated).toBe(false);
    const g2 = r.articles.find((a) => a.key === 'G2@LAW-DRAFT-2');
    expect(g2?.shortestWitness).not.toBeNull();
  });

  it('same-day multiple versions resolve deterministically by status and id', () => {
    const fixture: RevisionGraphInput = {
      versions: [
        { id: 'V-P', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
        { id: 'V-D', status: 'DRAFT', effectiveFrom: '2027-01-01' },
        { id: 'V-E', status: 'EFFECTIVE', effectiveFrom: '2027-01-01' },
      ],
      articles: [
        { stableId: 'X', version: 'V-D', label: 'x-d' },
        { stableId: 'X', version: 'V-P', label: 'x-p' },
        { stableId: 'X', version: 'V-E', label: 'x-e' },
      ],
      succession: [
        { from: 'X', to: 'X', kind: 'RENUMBER' },
      ],
      bindings: [],
    };
    const r1 = run(fixture, {
      fromVersionId: 'V-D',
      toVersionId: 'V-P',
      queryAt: '2026-08-03T00:00:00.000Z',
    });
    const r2 = run(fixture, {
      fromVersionId: 'V-D',
      toVersionId: 'V-P',
      queryAt: '2026-08-03T00:00:00.000Z',
    });
    expect(r1.context.graphHash).toBe(r2.context.graphHash);
    const order = r1.context.versionResolutions.map((v) => v.id);
    expect(order).toEqual(['V-D', 'V-P', 'V-E']);
  });
});
