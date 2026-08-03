import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SqliteService } from '../src/infrastructure/persistence/sqlite/sqlite.service';
import { DomainExceptionFilter } from '../src/interfaces/http/filters/domain-exception.filter';

const SAMPLE_GRAPH = {
  versions: [
    { id: 'LAW-V1', status: 'EFFECTIVE', effectiveFrom: '2026-01-01' },
    { id: 'LAW-DRAFT-2', status: 'DRAFT', effectiveFrom: null },
    { id: 'LAW-V2', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
  ],
  articles: [
    { stableId: 'ART-A', version: 'LAW-V1', label: '第十条', references: [] },
    {
      stableId: 'ART-B',
      version: 'LAW-V1',
      label: '第十一条',
      references: ['ART-A'],
    },
    { stableId: 'ART-A1', version: 'LAW-V2', label: '第十二条', references: [] },
    { stableId: 'ART-A2', version: 'LAW-V2', label: '第十三条', references: [] },
  ],
  succession: [{ from: 'ART-A', to: ['ART-A1', 'ART-A2'], kind: 'SPLIT' }],
  bindings: [
    { ruleId: 'RULE-ELIGIBILITY-01', articleIds: ['ART-A'] },
    { ruleId: 'RULE-SERVICE-02', articleIds: ['ART-B'] },
  ],
};

const MERGE_GRAPH = {
  versions: [
    { id: 'V1', status: 'EFFECTIVE', effectiveFrom: '2026-01-01' },
    { id: 'V2', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
  ],
  articles: [
    { stableId: 'X', version: 'V1', label: 'X', references: [] },
    { stableId: 'Y', version: 'V1', label: 'Y', references: ['X'] },
    { stableId: 'Z', version: 'V2', label: 'Z', references: [] },
  ],
  succession: [
    { from: 'X', to: ['Z'], kind: 'MERGE' },
    { from: 'Y', to: ['Z'], kind: 'MERGE' },
  ],
  bindings: [
    { ruleId: 'R-X', articleIds: ['X'] },
    { ruleId: 'R-Y', articleIds: ['Y'] },
  ],
};

const CYCLE_GRAPH = {
  versions: [
    { id: 'V1', status: 'EFFECTIVE', effectiveFrom: '2026-01-01' },
    { id: 'V2', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
  ],
  articles: [
    { stableId: 'C1', version: 'V1', label: 'C1', references: ['C3'] },
    { stableId: 'C2', version: 'V1', label: 'C2', references: ['C1'] },
    { stableId: 'C3', version: 'V1', label: 'C3', references: ['C2'] },
    { stableId: 'N1', version: 'V2', label: 'N1', references: [] },
  ],
  succession: [{ from: 'C1', to: ['N1'], kind: 'REVISE' }],
  bindings: [{ ruleId: 'R-C', articleIds: ['C2'] }],
};

const DRAFT2_GRAPH = {
  versions: [
    { id: 'LAW-V1', status: 'EFFECTIVE', effectiveFrom: '2026-01-01' },
    { id: 'LAW-DRAFT-2', status: 'DRAFT', effectiveFrom: null },
    { id: 'LAW-V2', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
  ],
  articles: [
    { stableId: 'ART-A', version: 'LAW-V1', label: '第十条', references: [] },
    { stableId: 'ART-B', version: 'LAW-V1', label: '第十一条', references: ['ART-A'] },
    { stableId: 'ART-C', version: 'LAW-V1', label: '第十二条', references: ['ART-A', 'ART-B'] },
    { stableId: 'ART-D', version: 'LAW-V1', label: '第十三条', references: [] },
    { stableId: 'ART-E', version: 'LAW-V1', label: '第十四条', references: ['ART-D'] },
    { stableId: 'ART-A1', version: 'LAW-DRAFT-2', label: '草案第十条之一', references: [] },
    { stableId: 'ART-A2', version: 'LAW-DRAFT-2', label: '草案第十条之二', references: [] },
    { stableId: 'ART-M', version: 'LAW-DRAFT-2', label: '草案合并条', references: [] },
    { stableId: 'ART-C1', version: 'LAW-DRAFT-2', label: '草案第十二条', references: ['ART-A1', 'ART-M'] },
    { stableId: 'ART-E1', version: 'LAW-DRAFT-2', label: '草案第十四条', references: [] },
    { stableId: 'ART-F', version: 'LAW-DRAFT-2', label: '草案新增交叉条', references: ['ART-A1', 'ART-M'] },
  ],
  succession: [
    { from: 'ART-A', to: ['ART-A1', 'ART-A2'], kind: 'SPLIT' },
    { from: 'ART-A', to: ['ART-M'], kind: 'MERGE' },
    { from: 'ART-B', to: ['ART-M'], kind: 'MERGE' },
    { from: 'ART-C', to: ['ART-C1'], kind: 'REVISE' },
    { from: 'ART-E', to: ['ART-E1'], kind: 'REVISE' },
  ],
  bindings: [
    { ruleId: 'RULE-DIR-01', articleIds: ['ART-A'] },
    { ruleId: 'RULE-MERGE-02', articleIds: ['ART-B'] },
    { ruleId: 'RULE-REF-03', articleIds: ['ART-F'] },
    { ruleId: 'RULE-MISSING-04', articleIds: ['ART-D'] },
    { ruleId: 'RULE-REF-D-05', articleIds: ['ART-E'] },
    { ruleId: 'RULE-DRAFT-06', articleIds: ['ART-A1', 'ART-M'] },
    { ruleId: 'RULE-CARRY-07', articleIds: ['ART-C1'] },
  ],
};

describe('Legal Rule Impact Tracer — Acceptance (e2e)', () => {
  let app: INestApplication;
  let sqlite: SqliteService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new DomainExceptionFilter());
    sqlite = app.get(SqliteService);
    await app.init();
  });

  afterEach(async () => {
    sqlite.close();
    await app.close();
  });

  describe('POST /api/v1/import', () => {
    it('imports the sample revision graph and returns fingerprint', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/import')
        .send(SAMPLE_GRAPH)
        .expect(200);

      expect(res.body.versionsImported).toBe(3);
      expect(res.body.articlesImported).toBe(4);
      expect(res.body.successionsImported).toBe(2);
      expect(res.body.bindingsImported).toBe(2);
      expect(res.body.graphFingerprint).toMatch(/^fp_[0-9a-f]+$/);
    });

    it('is idempotent on duplicate import', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/import')
        .send(SAMPLE_GRAPH)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/v1/import')
        .send(SAMPLE_GRAPH)
        .expect(200);

      expect(res.body.versionsImported).toBe(0);
      expect(res.body.articlesImported).toBe(0);
      expect(res.body.successionsImported).toBe(0);
      expect(res.body.bindingsImported).toBe(0);
    });

    it('rejects invalid graph with 400', async () => {
      const bad = {
        ...SAMPLE_GRAPH,
        articles: [
          {
            stableId: 'BAD',
            version: 'NONEXISTENT',
            label: 'Bad',
            references: [],
          },
        ],
      };
      await request(app.getHttpServer())
        .post('/api/v1/import')
        .send(bad)
        .expect(400);
    });
  });

  describe('POST /api/v1/impact/query', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/api/v1/import')
        .send(SAMPLE_GRAPH)
        .expect(200);
    });

    it('returns direct, indirect and unaffected sets for a split revision', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({ sourceVersionId: 'LAW-V1', targetVersionId: 'LAW-V2' })
        .expect(200);

      const body = res.body;
      expect(body.snapshotId).toBeDefined();
      expect(body.report.sourceVersionId).toBe('LAW-V1');
      expect(body.report.targetVersionId).toBe('LAW-V2');
      expect(body.report.queriedAt).toBeDefined();
      expect(body.report.graphFingerprint).toMatch(/^fp_/);

      const directIds = body.report.directArticles.map(
        (a: { stableId: string }) => a.stableId,
      );
      expect(directIds).toContain('ART-A');
      expect(directIds).toContain('ART-A1');
      expect(directIds).toContain('ART-A2');

      const indirectIds = body.report.indirectArticles.map(
        (a: { stableId: string }) => a.stableId,
      );
      expect(indirectIds).toContain('ART-B');

      const directRules = body.report.directRules.map(
        (r: { ruleId: string }) => r.ruleId,
      );
      expect(directRules).toContain('RULE-ELIGIBILITY-01');

      const indirectRules = body.report.indirectRules.map(
        (r: { ruleId: string }) => r.ruleId,
      );
      expect(indirectRules).toContain('RULE-SERVICE-02');
    });

    it('produces ordered propagation paths', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({ sourceVersionId: 'LAW-V1', targetVersionId: 'LAW-V2' })
        .expect(200);

      const paths = res.body.report.paths;
      expect(paths.length).toBeGreaterThan(0);

      for (let i = 1; i < paths.length; i++) {
        expect(paths[i - 1].depth).toBeLessThanOrEqual(paths[i].depth);
      }

      const pathToB = paths.find(
        (p: { targetId: string; depth: number }) =>
          p.targetId === 'ART-B' && p.depth > 0,
      );
      expect(pathToB).toBeDefined();
      expect(pathToB.hops.length).toBeGreaterThan(0);
    });

    it('persists an immutable snapshot retrievable by id', async () => {
      const queryRes = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({ sourceVersionId: 'LAW-V1', targetVersionId: 'LAW-V2' })
        .expect(200);

      const snapshotId = queryRes.body.snapshotId;

      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/snapshots/${snapshotId}`)
        .expect(200);

      expect(getRes.body.snapshotId).toBe(snapshotId);
      expect(getRes.body.report.directArticles).toEqual(
        queryRes.body.report.directArticles,
      );
      expect(getRes.body.report.paths).toEqual(queryRes.body.report.paths);
    });

    it('returns 404 for unknown snapshot', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/snapshots/nonexistent-id')
        .expect(404);
    });
  });

  describe('merge (many-to-one)', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/api/v1/import')
        .send(MERGE_GRAPH)
        .expect(200);
    });

    it('traces both merge sources as DIRECT', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({ sourceVersionId: 'V1', targetVersionId: 'V2' })
        .expect(200);

      const directIds = res.body.report.directArticles.map(
        (a: { stableId: string }) => a.stableId,
      );
      expect(directIds).toContain('X');
      expect(directIds).toContain('Y');
      expect(directIds).toContain('Z');
    });
  });

  describe('cross-reference cycles', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/api/v1/import')
        .send(CYCLE_GRAPH)
        .expect(200);
    });

    it('terminates without infinite loop and reports all cycle members', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({ sourceVersionId: 'V1', targetVersionId: 'V2' })
        .expect(200);

      expect(res.body.report.paths.length).toBeGreaterThan(0);
      expect(res.body.report.paths.length).toBeLessThan(1000);

      const indirectIds = res.body.report.indirectArticles.map(
        (a: { stableId: string }) => a.stableId,
      );
      expect(indirectIds).toContain('C2');
      expect(indirectIds).toContain('C3');
    });
  });

  describe('missing succession reporting', () => {
    beforeEach(async () => {
      const graph = {
        versions: [
          { id: 'V1', status: 'EFFECTIVE', effectiveFrom: '2026-01-01' },
          { id: 'V2', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
        ],
        articles: [
          { stableId: 'A', version: 'V1', label: 'A', references: [] },
          { stableId: 'B', version: 'V1', label: 'B', references: [] },
          { stableId: 'A2', version: 'V2', label: 'A2', references: [] },
        ],
        succession: [{ from: 'A', to: ['A2'], kind: 'RENAME' }],
        bindings: [],
      };
      await request(app.getHttpServer())
        .post('/api/v1/import')
        .send(graph)
        .expect(200);
    });

    it('reports articles without explicit succession edge', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({ sourceVersionId: 'V1', targetVersionId: 'V2' })
        .expect(200);

      expect(res.body.report.missingSuccessions).toHaveLength(1);
      expect(res.body.report.missingSuccessions[0].stableId).toBe('B');
    });
  });

  describe('snapshot immutability', () => {
    it('old snapshot does not change when graph data is modified', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/import')
        .send(SAMPLE_GRAPH)
        .expect(200);

      const query1 = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({ sourceVersionId: 'LAW-V1', targetVersionId: 'LAW-V2' })
        .expect(200);

      const snapshotId = query1.body.snapshotId;
      const originalPaths = query1.body.report.paths.length;
      const originalFingerprint = query1.body.report.graphFingerprint;

      const additionalData = {
        versions: [
          { id: 'LAW-V3', status: 'DRAFT', effectiveFrom: null },
        ],
        articles: [
          {
            stableId: 'ART-EXTRA',
            version: 'LAW-V3',
            label: '附加条',
            references: ['ART-A'],
          },
        ],
        succession: [],
        bindings: [],
      };
      await request(app.getHttpServer())
        .post('/api/v1/import')
        .send(additionalData)
        .expect(200);

      const snapshotRes = await request(app.getHttpServer())
        .get(`/api/v1/snapshots/${snapshotId}`)
        .expect(200);

      expect(snapshotRes.body.report.paths.length).toBe(originalPaths);
      expect(snapshotRes.body.report.graphFingerprint).toBe(
        originalFingerprint,
      );
      expect(snapshotRes.body.report.targetVersionId).toBe('LAW-V2');
    });
  });

  describe('GET /api/v1/snapshots', () => {
    it('lists all snapshots ordered by creation time', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/import')
        .send(SAMPLE_GRAPH)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({ sourceVersionId: 'LAW-V1', targetVersionId: 'LAW-V2' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/v1/snapshots')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].snapshotId).toBeDefined();
    });
  });

  describe('LAW-DRAFT-2 — split + merge + missing edge', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/api/v1/import')
        .send(DRAFT2_GRAPH)
        .expect(200);
    });

    it('classifies direct, indirect and unaffected rules', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({ sourceVersionId: 'LAW-V1', targetVersionId: 'LAW-DRAFT-2' })
        .expect(200);

      const r = res.body.report;
      const directRuleIds = r.directRules.map(
        (x: { ruleId: string }) => x.ruleId,
      );
      const indirectRuleIds = r.indirectRules.map(
        (x: { ruleId: string }) => x.ruleId,
      );
      const unaffectedRuleIds = r.unaffectedRules.map(
        (x: { ruleId: string }) => x.ruleId,
      );

      expect(directRuleIds).toContain('RULE-DIR-01');
      expect(directRuleIds).toContain('RULE-MERGE-02');
      expect(directRuleIds).toContain('RULE-REF-D-05');
      expect(directRuleIds).toContain('RULE-DRAFT-06');
      expect(directRuleIds).toContain('RULE-CARRY-07');
      expect(indirectRuleIds).toContain('RULE-REF-03');
      expect(unaffectedRuleIds).toContain('RULE-MISSING-04');
    });

    it('reports exactly one missing succession edge for ART-D', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({ sourceVersionId: 'LAW-V1', targetVersionId: 'LAW-DRAFT-2' })
        .expect(200);

      expect(res.body.report.missingSuccessions).toHaveLength(1);
      expect(res.body.report.missingSuccessions[0].stableId).toBe('ART-D');
      expect(
        res.body.report.missingSuccessions[0].reason,
      ).toContain('no explicit succession edge');
    });

    it('provides shortest witness with equal-length count for each affected rule', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({ sourceVersionId: 'LAW-V1', targetVersionId: 'LAW-DRAFT-2' })
        .expect(200);

      const witnesses = res.body.report.ruleWitnesses;

      const refWitness = witnesses.find(
        (w: { ruleId: string }) => w.ruleId === 'RULE-REF-03',
      );
      expect(refWitness).toBeDefined();
      expect(refWitness.shortestDistance).toBe(1);
      expect(refWitness.equalLengthPathCount).toBe(2);
      expect(refWitness.witness.hops).toHaveLength(1);
      expect(refWitness.witness.targetId).toBe('ART-F');

      const draftWitness = witnesses.find(
        (w: { ruleId: string }) => w.ruleId === 'RULE-DRAFT-06',
      );
      expect(draftWitness.shortestDistance).toBe(0);
      expect(draftWitness.equalLengthPathCount).toBe(2);

      const missingWitness = witnesses.find(
        (w: { ruleId: string }) => w.ruleId === 'RULE-MISSING-04',
      );
      expect(missingWitness).toBeUndefined();
    });

    it('produces byte-identical paths and witnesses across repeated queries', async () => {
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({ sourceVersionId: 'LAW-V1', targetVersionId: 'LAW-DRAFT-2' })
        .expect(200);
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({ sourceVersionId: 'LAW-V1', targetVersionId: 'LAW-DRAFT-2' })
        .expect(200);

      const r1 = res1.body.report;
      const r2 = res2.body.report;
      expect(JSON.stringify(r1.paths)).toBe(JSON.stringify(r2.paths));
      expect(JSON.stringify(r1.missingSuccessions)).toBe(
        JSON.stringify(r2.missingSuccessions),
      );
      expect(JSON.stringify(r1.ruleWitnesses)).toBe(
        JSON.stringify(r2.ruleWitnesses),
      );
      expect(r1.graphFingerprint).toBe(r2.graphFingerprint);
      expect(r1.directArticles).toEqual(r2.directArticles);
      expect(r1.indirectArticles).toEqual(r2.indirectArticles);
    });
  });

  describe('Four timepoints and backfill via HTTP', () => {
    const TIMELINE_GRAPH = {
      versions: [
        { id: 'LAW-V1', status: 'EFFECTIVE', effectiveFrom: '2026-01-01' },
        { id: 'LAW-DRAFT-2', status: 'DRAFT', effectiveFrom: null },
        { id: 'LAW-V2', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
      ],
      articles: [
        { stableId: 'T-A', version: 'LAW-V1', label: 'V1-A', references: [] },
        { stableId: 'T-B', version: 'LAW-V1', label: 'V1-B', references: ['T-A'] },
        { stableId: 'T-C', version: 'LAW-V1', label: 'V1-C', references: [] },
        { stableId: 'T-D', version: 'LAW-V1', label: 'V1-D', references: [] },
        { stableId: 'T-A1', version: 'LAW-DRAFT-2', label: 'D-A1', references: [] },
        { stableId: 'T-A2', version: 'LAW-DRAFT-2', label: 'D-A2', references: [] },
        { stableId: 'T-M', version: 'LAW-DRAFT-2', label: 'D-M', references: [] },
        { stableId: 'T-A1V2', version: 'LAW-V2', label: 'V2-A1', references: [] },
        { stableId: 'T-A2V2', version: 'LAW-V2', label: 'V2-A2', references: [] },
        { stableId: 'T-MV2', version: 'LAW-V2', label: 'V2-M', references: [] },
        { stableId: 'T-C1', version: 'LAW-V2', label: 'V2-C1', references: ['T-A1V2'] },
        { stableId: 'T-D1', version: 'LAW-V2', label: 'V2-D1', references: [] },
      ],
      succession: [
        { from: 'T-A', to: ['T-A1', 'T-A2'], kind: 'SPLIT' },
        { from: 'T-A', to: ['T-M'], kind: 'MERGE' },
        { from: 'T-B', to: ['T-M'], kind: 'MERGE' },
        { from: 'T-A', to: ['T-A1V2', 'T-A2V2'], kind: 'SPLIT' },
        { from: 'T-A', to: ['T-MV2'], kind: 'MERGE' },
        { from: 'T-B', to: ['T-MV2'], kind: 'MERGE' },
        { from: 'T-C', to: ['T-C1'], kind: 'REVISE' },
      ],
      bindings: [
        { ruleId: 'T-RULE-A', articleIds: ['T-A'] },
        { ruleId: 'T-RULE-B', articleIds: ['T-B'] },
        { ruleId: 'T-RULE-C', articleIds: ['T-C'] },
        { ruleId: 'T-RULE-D', articleIds: ['T-D'] },
        { ruleId: 'T-RULE-C1', articleIds: ['T-C1'] },
      ],
    };

    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/api/v1/import')
        .send(TIMELINE_GRAPH)
        .expect(200);
    });

    it('timepoint 1 — draft period reports DRAFT phase', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({
          sourceVersionId: 'LAW-V1',
          targetVersionId: 'LAW-DRAFT-2',
          asOf: '2026-06-01T00:00:00.000Z',
        })
        .expect(200);

      expect(res.body.report.timepoint.phase).toBe('DRAFT');
      expect(res.body.report.timepoint.asOf).toBe(
        '2026-06-01T00:00:00.000Z',
      );
      expect(res.body.report.edgeSequence.hash).toMatch(/^es_/);
      expect(res.body.report.graphFingerprint).toMatch(/^fp_/);
    });

    it('timepoint 2 — published but not effective reports PUBLISHED_NOT_EFFECTIVE', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({
          sourceVersionId: 'LAW-V1',
          targetVersionId: 'LAW-V2',
          asOf: '2026-06-01T00:00:00.000Z',
        })
        .expect(200);

      expect(res.body.report.timepoint.phase).toBe(
        'PUBLISHED_NOT_EFFECTIVE',
      );
      expect(res.body.report.timepoint.targetVersion.effectiveAtQuery).toBe(
        false,
      );
      const missing = res.body.report.missingSuccessions.map(
        (m: { stableId: string }) => m.stableId,
      );
      expect(missing).toContain('T-D');
    });

    it('timepoint 3 — after effective reports EFFECTIVE phase', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({
          sourceVersionId: 'LAW-V1',
          targetVersionId: 'LAW-V2',
          asOf: '2027-06-01T00:00:00.000Z',
        })
        .expect(200);

      expect(res.body.report.timepoint.phase).toBe('EFFECTIVE');
      expect(res.body.report.timepoint.targetVersion.effectiveAtQuery).toBe(
        true,
      );
    });

    it('timepoint 4 — backfill adds edge, reports POST_BACKFILL, old snapshot unchanged', async () => {
      const beforeRes = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({
          sourceVersionId: 'LAW-V1',
          targetVersionId: 'LAW-V2',
          asOf: '2027-06-01T00:00:00.000Z',
        })
        .expect(200);

      const beforeSnapshotId = beforeRes.body.snapshotId;
      const beforeMissing =
        beforeRes.body.report.missingSuccessions.map(
          (m: { stableId: string }) => m.stableId,
        );
      expect(beforeMissing).toContain('T-D');
      const beforeFingerprint = beforeRes.body.report.graphFingerprint;
      const beforeEdgeHash = beforeRes.body.report.edgeSequence.hash;

      const backfillRes = await request(app.getHttpServer())
        .post('/api/v1/backfill')
        .send({ from: 'T-D', to: 'T-D1', kind: 'REVISE' })
        .expect(200);

      expect(backfillRes.body.added).toBe(true);
      expect(backfillRes.body.backfillCount).toBe(1);
      expect(backfillRes.body.graphFingerprint).not.toBe(
        beforeFingerprint,
      );

      const afterRes = await request(app.getHttpServer())
        .post('/api/v1/impact/query')
        .send({
          sourceVersionId: 'LAW-V1',
          targetVersionId: 'LAW-V2',
          asOf: '2027-06-01T00:00:00.000Z',
        })
        .expect(200);

      expect(afterRes.body.report.timepoint.phase).toBe(
        'POST_BACKFILL',
      );
      expect(afterRes.body.report.timepoint.backfillCount).toBe(1);
      const afterMissing =
        afterRes.body.report.missingSuccessions.map(
          (m: { stableId: string }) => m.stableId,
        );
      expect(afterMissing).not.toContain('T-D');
      expect(afterRes.body.report.graphFingerprint).not.toBe(
        beforeFingerprint,
      );
      expect(afterRes.body.report.edgeSequence.hash).not.toBe(
        beforeEdgeHash,
      );

      const oldSnapshot = await request(app.getHttpServer())
        .get(`/api/v1/snapshots/${beforeSnapshotId}`)
        .expect(200);

      expect(
        oldSnapshot.body.report.missingSuccessions.find(
          (m: { stableId: string }) => m.stableId === 'T-D',
        ),
      ).toBeDefined();
      expect(oldSnapshot.body.report.graphFingerprint).toBe(
        beforeFingerprint,
      );
      expect(oldSnapshot.body.report.edgeSequence.hash).toBe(
        beforeEdgeHash,
      );
      expect(oldSnapshot.body.report.timepoint.backfillCount).toBe(0);
    });

    it('backfill is idempotent — duplicate backfill does not increase count', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/backfill')
        .send({ from: 'T-D', to: 'T-D1', kind: 'REVISE' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/v1/backfill')
        .send({ from: 'T-D', to: 'T-D1', kind: 'REVISE' })
        .expect(200);

      expect(res.body.added).toBe(false);
      expect(res.body.backfillCount).toBe(1);
    });

    it('rejects backfill referencing unknown article with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/backfill')
        .send({ from: 'NOPE', to: 'T-D1', kind: 'REVISE' })
        .expect(400);
    });
  });
});
