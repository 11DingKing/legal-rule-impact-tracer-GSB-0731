import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppServicesModule } from './app-services.module';
import { ImportService } from './import.service';
import { ImpactService } from './impact.service';
import type { RevisionGraphInput } from '../domain';
import {
  TIMEPOINT_BASE_FIXTURE,
  TIMEPOINT_BACKFILL_EDGE,
  TIMEPOINTS,
} from '../domain/fixtures/timepoints.fixture';

describe('backfill drift prevention and cache invalidation (NestJS + SQLite)', () => {
  let app: INestApplication;
  let importService: ImportService;
  let impactService: ImpactService;

  beforeEach(async () => {
    process.env.DB_PATH = ':memory:';
    const mod = await Test.createTestingModule({
      imports: [AppServicesModule],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
    importService = mod.get(ImportService);
    impactService = mod.get(ImpactService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('an old snapshot taken before backfill keeps missing-Z diagnostic on replay even after backfill is imported', () => {
    importService.import(TIMEPOINT_BASE_FIXTURE);

    const beforeBackfill = impactService.queryImpact(TIMEPOINTS.effective);
    expect(beforeBackfill.result.missingSuccession).toEqual(
      expect.arrayContaining([expect.objectContaining({ stableId: 'Z' })]),
    );

    importService.import({
      versions: [],
      articles: [],
      succession: [TIMEPOINT_BACKFILL_EDGE],
      bindings: [],
    });

    const replayed = impactService.replaySnapshot(beforeBackfill.snapshot.id);
    expect(replayed.missingSuccession).toEqual(
      expect.arrayContaining([expect.objectContaining({ stableId: 'Z' })]),
    );
    expect(replayed.context.propagationEdgeSequence).toEqual(
      beforeBackfill.result.context.propagationEdgeSequence,
    );
    expect(replayed.context.graphHash).toBe(
      beforeBackfill.result.context.graphHash,
    );
  });

  it('a new query after backfill at a post-backfill timepoint sees Z connected and RULE-Z impacted', () => {
    importService.import(TIMEPOINT_BASE_FIXTURE);
    impactService.queryImpact(TIMEPOINTS.postBackfill);

    importService.import({
      versions: [],
      articles: [],
      succession: [TIMEPOINT_BACKFILL_EDGE],
      bindings: [],
    });

    const after = impactService.queryImpact(TIMEPOINTS.postBackfill);
    expect(after.result.missingSuccession).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ stableId: 'Z' })]),
    );
    const zRule = after.result.rules.find((r) => r.ruleId === 'RULE-Z');
    expect(zRule).toBeTruthy();
    expect(zRule?.level).not.toBe('UNAFFECTED');
  });

  it('cache hits on identical query, misses when graph/backfill changes query hash', () => {
    importService.import(TIMEPOINT_BASE_FIXTURE);
    impactService.clearCache();

    const first = impactService.queryImpact(TIMEPOINTS.effective);
    expect(first.cacheHit).toBe(false);

    const second = impactService.queryImpact(TIMEPOINTS.effective);
    expect(second.cacheHit).toBe(true);
    expect(second.snapshot.id).toBe(first.snapshot.id);

    importService.import({
      versions: [],
      articles: [],
      succession: [TIMEPOINT_BACKFILL_EDGE],
      bindings: [],
    });

    const third = impactService.queryImpact(TIMEPOINTS.postBackfill);
    expect(third.cacheHit).toBe(false);
    expect(third.snapshot.id).not.toBe(first.snapshot.id);

    const fourth = impactService.queryImpact(TIMEPOINTS.postBackfill);
    expect(fourth.cacheHit).toBe(true);
    expect(fourth.snapshot.id).toBe(third.snapshot.id);
  });

  it('backfill does not affect a pre-backfill query moment even after the edge is recorded (suppressed by recordedAt)', () => {
    importService.import(TIMEPOINT_BASE_FIXTURE);
    const beforeEdge = impactService.queryImpact(TIMEPOINTS.effective);

    importService.import({
      versions: [],
      articles: [],
      succession: [TIMEPOINT_BACKFILL_EDGE],
      bindings: [],
    });

    const afterEdgeSameMoment = impactService.queryImpact(TIMEPOINTS.effective);
    expect(afterEdgeSameMoment.result.context.graphHash).toBe(
      beforeEdge.result.context.graphHash,
    );
    expect(afterEdgeSameMoment.result.missingSuccession).toEqual(
      beforeEdge.result.missingSuccession,
    );
    expect(afterEdgeSameMoment.result.context.suppressedBackfillCount).toBeGreaterThan(0);
  });

  it('importing reverse-order and duplicate data produces byte-identical query context', async () => {
    const reverse: RevisionGraphInput = {
      versions: [...TIMEPOINT_BASE_FIXTURE.versions].reverse(),
      articles: [...TIMEPOINT_BASE_FIXTURE.articles].reverse(),
      succession: [...TIMEPOINT_BASE_FIXTURE.succession].reverse(),
      bindings: [...TIMEPOINT_BASE_FIXTURE.bindings].reverse(),
    };
    const duplicate: RevisionGraphInput = {
      versions: [
        ...TIMEPOINT_BASE_FIXTURE.versions,
        ...TIMEPOINT_BASE_FIXTURE.versions,
      ],
      articles: [
        ...TIMEPOINT_BASE_FIXTURE.articles,
        ...TIMEPOINT_BASE_FIXTURE.articles,
      ],
      succession: [
        ...TIMEPOINT_BASE_FIXTURE.succession,
        ...TIMEPOINT_BASE_FIXTURE.succession,
      ],
      bindings: [
        ...TIMEPOINT_BASE_FIXTURE.bindings,
        ...TIMEPOINT_BASE_FIXTURE.bindings,
      ],
    };

    importService.import(TIMEPOINT_BASE_FIXTURE);
    const a = impactService.queryImpact(TIMEPOINTS.effective).result;

    const mod2 = await Test.createTestingModule({
      imports: [AppServicesModule],
    }).compile();
    const app2 = mod2.createNestApplication();
    await app2.init();
    mod2.get(ImportService).import(reverse);
    const b = mod2.get(ImpactService).queryImpact(TIMEPOINTS.effective).result;
    await app2.close();

    const mod3 = await Test.createTestingModule({
      imports: [AppServicesModule],
    }).compile();
    const app3 = mod3.createNestApplication();
    await app3.init();
    mod3.get(ImportService).import(duplicate);
    const c = mod3.get(ImpactService).queryImpact(TIMEPOINTS.effective).result;
    await app3.close();

    const fp = (r: typeof a) =>
      JSON.stringify({
        hash: r.context.graphHash,
        seq: r.context.propagationEdgeSequence,
        direct: r.directKeys,
        indirect: r.indirectKeys,
        missing: r.missingSuccession,
        rules: r.rules.map((x) => ({
          id: x.ruleId,
          level: x.level,
          count: x.equalLengthWitnessCount,
        })),
      });
    expect(fp(b)).toBe(fp(a));
    expect(fp(c)).toBe(fp(a));
  });
});
