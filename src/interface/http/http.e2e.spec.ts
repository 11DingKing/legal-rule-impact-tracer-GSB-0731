import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';

describe('HTTP e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DB_PATH = ':memory:';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('imports fixture via POST /api/import', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/import')
      .send({
        versions: [
          { id: 'V1', status: 'EFFECTIVE', effectiveFrom: '2026-01-01' },
          { id: 'V2', status: 'PUBLISHED', effectiveFrom: '2027-01-01' },
        ],
        articles: [
          { stableId: 'A', version: 'V1', label: 'A' },
          { stableId: 'B', version: 'V1', label: 'B', references: ['A'] },
          { stableId: 'A1', version: 'V2', label: 'A1' },
          { stableId: 'A2', version: 'V2', label: 'A2' },
        ],
        succession: [{ from: 'A', to: ['A1', 'A2'], kind: 'SPLIT' }],
        bindings: [
          { ruleId: 'R1', articleIds: ['A'] },
          { ruleId: 'R2', articleIds: ['B'] },
        ],
      })
      .expect(201);
    expect(res.body.importedVersions).toBe(2);
    expect(res.body.importedArticles).toBe(4);
  });

  it('queries impact via POST /api/impact/query', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/impact/query')
      .send({
        fromVersionId: 'V1',
        toVersionId: 'V2',
        queryAt: '2026-08-01T00:00:00.000Z',
      })
      .expect(201);
    expect(res.body.snapshotId).toBeTruthy();
    expect(res.body.result.directKeys).toEqual(
      expect.arrayContaining(['A@V1', 'A1@V2', 'A2@V2']),
    );
    expect(res.body.result.indirectKeys).toContain('B@V1');
    const r1 = res.body.result.rules.find(
      (r: { ruleId: string }) => r.ruleId === 'R1',
    );
    expect(r1.level).toBe('DIRECT');
    const r2 = res.body.result.rules.find(
      (r: { ruleId: string }) => r.ruleId === 'R2',
    );
    expect(r2.level).toBe('INDIRECT');
  });

  it('lists snapshots and replays one', async () => {
    const list = await request(app.getHttpServer()).get('/api/snapshots').expect(200);
    expect(list.body.length).toBeGreaterThan(0);
    const id = list.body[0].id;
    const replay = await request(app.getHttpServer())
      .post(`/api/snapshots/${id}/replay`)
      .expect(201);
    expect(replay.body.directKeys).toEqual(
      expect.arrayContaining(['A@V1', 'A1@V2', 'A2@V2']),
    );
  });
});
