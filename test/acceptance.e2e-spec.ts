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
});
