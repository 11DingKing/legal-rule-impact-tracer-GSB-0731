import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppServicesModule } from './app-services.module';
import { ImportService } from './import.service';
import { ImpactService } from './impact.service';
import type { RevisionGraphInput } from '../domain';

const fixture: RevisionGraphInput = {
  versions: [
    { id: 'LAW-V1', status: 'EFFECTIVE', effectiveFrom: '2026-01-01' },
    { id: 'LAW-V2', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
  ],
  articles: [
    { stableId: 'ART-A', version: 'LAW-V1', label: '第十条' },
    { stableId: 'ART-B', version: 'LAW-V1', label: '第十一条', references: ['ART-A'] },
    { stableId: 'ART-A1', version: 'LAW-V2', label: '第十二条' },
    { stableId: 'ART-A2', version: 'LAW-V2', label: '第十三条' },
  ],
  succession: [{ from: 'ART-A', to: ['ART-A1', 'ART-A2'], kind: 'SPLIT' }],
  bindings: [
    { ruleId: 'RULE-ELIGIBILITY-01', articleIds: ['ART-A'] },
    { ruleId: 'RULE-SERVICE-02', articleIds: ['ART-B'] },
  ],
};

describe('Import + Impact integration', () => {
  let importService: ImportService;
  let impactService: ImpactService;
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DB_PATH = ':memory:';
    const mod = await Test.createTestingModule({
      imports: [AppServicesModule],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
    importService = mod.get(ImportService);
    impactService = mod.get(ImpactService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('imports the fixture and reports counts', () => {
    const report = importService.import(fixture);
    expect(report.importedVersions).toBe(2);
    expect(report.importedArticles).toBe(4);
    expect(report.duplicateVersions).toBe(0);
    expect(report.duplicateArticles).toBe(0);
  });

  it('is idempotent: duplicate import counts duplicates and does not double-insert', () => {
    const report = importService.import(fixture);
    expect(report.importedVersions).toBe(0);
    expect(report.duplicateVersions).toBe(2);
    expect(report.importedArticles).toBe(0);
    expect(report.duplicateArticles).toBe(4);
  });

  it('computes DIRECT/INDIRECT/UNAFFECTED and persists a snapshot', () => {
    const { result, snapshot } = impactService.queryImpact({
      fromVersionId: 'LAW-V1',
      toVersionId: 'LAW-V2',
      queryAt: '2026-08-01T00:00:00.000Z',
    });
    expect(snapshot.id).toBeTruthy();
    expect(result.directKeys).toEqual(
      expect.arrayContaining([
        'ART-A@LAW-V1',
        'ART-A1@LAW-V2',
        'ART-A2@LAW-V2',
      ]),
    );
    expect(result.indirectKeys).toContain('ART-B@LAW-V1');
    const eligibility = result.rules.find((r) => r.ruleId === 'RULE-ELIGIBILITY-01');
    expect(eligibility?.level).toBe('DIRECT');
    const service = result.rules.find((r) => r.ruleId === 'RULE-SERVICE-02');
    expect(service?.level).toBe('INDIRECT');
  });

  it('replays a snapshot to the exact same result after additional data is imported', () => {
    const first = impactService.queryImpact({
      fromVersionId: 'LAW-V1',
      toVersionId: 'LAW-V2',
      queryAt: '2026-08-01T00:00:00.000Z',
    });

    importService.import({
      versions: [],
      articles: [
        {
          stableId: 'ART-C',
          version: 'LAW-V1',
          label: '第十二条',
          references: ['ART-A'],
        },
      ],
      succession: [],
      bindings: [],
    });

    const after = impactService.queryImpact({
      fromVersionId: 'LAW-V1',
      toVersionId: 'LAW-V2',
      queryAt: '2026-08-01T00:00:00.000Z',
    });
    expect(after.result.indirectKeys).toContain('ART-C@LAW-V1');

    const replayed = impactService.replaySnapshot(first.snapshot.id);
    expect(replayed.indirectKeys).not.toContain('ART-C@LAW-V1');
    expect(JSON.stringify(replayed)).toEqual(
      JSON.stringify(first.snapshot.result),
    );
  });

  it('lists snapshots and can fetch one by id', () => {
    const list = impactService.listSnapshots();
    expect(list.length).toBeGreaterThan(0);
    const one = impactService.getSnapshot(list[0].id);
    expect(one.id).toBe(list[0].id);
  });

  it('throws on unknown version id', () => {
    expect(() =>
      impactService.queryImpact({
        fromVersionId: 'NOPE',
        toVersionId: 'LAW-V2',
        queryAt: '2026-08-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('same-day multiple versions', () => {
  it('orders same-day versions by status then id and still queries correctly', async () => {
    process.env.DB_PATH = ':memory:';
    const mod = await Test.createTestingModule({
      imports: [AppServicesModule],
    }).compile();
    const app2 = mod.createNestApplication();
    await app2.init();
    const imp = mod.get(ImportService);
    const q = mod.get(ImpactService);

    imp.import({
      versions: [
        { id: 'V-B', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
        { id: 'V-D', status: 'DRAFT', effectiveFrom: '2027-01-01' },
        { id: 'V-E', status: 'EFFECTIVE', effectiveFrom: '2027-01-01' },
      ],
      articles: [
        { stableId: 'A', version: 'V-E', label: 'A' },
        { stableId: 'A2', version: 'V-B', label: 'A2' },
      ],
      succession: [{ from: 'A', to: 'A2', kind: 'REPLACE' }],
      bindings: [],
    });

    const { result } = q.queryImpact({
      fromVersionId: 'V-E',
      toVersionId: 'V-B',
      queryAt: '2026-08-01T00:00:00.000Z',
    });
    expect(result.directKeys).toEqual(
      expect.arrayContaining(['A@V-E', 'A2@V-B']),
    );
    await app2.close();
  });
});
