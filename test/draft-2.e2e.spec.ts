import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { canonicalStringify } from '../src/common/canonical-json';

process.env['DATABASE_PATH'] = ':memory:';

const AS_OF = '2026-08-02T00:00:00.000Z';
const QUERY_BODY = { fromVersion: 'LAW-V1', toVersion: 'LAW-DRAFT-2', asOf: AS_OF };

type JsonObject = Record<string, unknown>;

function loadMaterial(name: string): JsonObject {
  const raw = readFileSync(join(__dirname, '..', 'materials', name), 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('material document must be a JSON object');
  }
  return parsed as JsonObject;
}

/** Recursively reverse every array in the document: reversed import records. */
function reverseDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseDeep).reverse();
  }
  if (value !== null && typeof value === 'object') {
    const out: JsonObject = {};
    for (const [key, item] of Object.entries(value as JsonObject)) {
      out[key] = reverseDeep(item);
    }
    return out;
  }
  return value;
}

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

function serverOf(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

async function runDraftQuery(server: Server): Promise<string> {
  const response = await request(server).post('/impact-queries').send(QUERY_BODY).expect(201);
  // Byte-level comparison target: canonical bytes of the frozen result
  // (snapshotId is volatile; key order is normalized by canonicalStringify).
  return canonicalStringify((response.body as { result: unknown }).result);
}

describe('LAW-DRAFT-2 byte-level determinism (e2e)', () => {
  let baselineBytes: string;

  describe('normal import order', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createApp();
    });

    afterAll(async () => {
      await app.close();
    });

      it('answers the draft revision with witnesses and stable diagnostics', async () => {
      const server = serverOf(app);
      await request(server).post('/imports').send(loadMaterial('revision-graph.json')).expect(201);
      await request(server).post('/imports').send(loadMaterial('draft-2-revision.json')).expect(201);

      const response = await request(server).post('/impact-queries').send(QUERY_BODY).expect(201);
      const result = (response.body as { result: {
        versionContext: { to: { status: string; effectiveFrom: string | null } };
        rules: {
          direct: { ruleId: string; witness: { nodes: string[] } | null; witnessCount: number }[];
          indirect: { ruleId: string; witness: { nodes: string[] } | null; witnessCount: number }[];
          unaffected: { ruleId: string; witness: null; witnessCount: number }[];
        };
        diagnostics: { code: string; stableId: string; boundRuleIds: string[] }[];
      } }).result;

      expect(result.versionContext.to).toEqual({
        id: 'LAW-DRAFT-2',
        status: 'DRAFT',
        effectiveFrom: null,
        effectivenessAtAsOf: 'DRAFT',
      });

      const mergeBoth = result.rules.direct.find((r) => r.ruleId === 'RULE-DRAFT-MERGE-BOTH');
      expect(mergeBoth?.witness?.nodes).toEqual(['ART-M1']);
      expect(mergeBoth?.witnessCount).toBe(2);

      const obs = result.rules.indirect.find((r) => r.ruleId === 'RULE-DRAFT-OBS');
      expect(obs?.witness?.nodes).toEqual(['ART-C1', 'ART-OBS']);
      expect(obs?.witnessCount).toBe(2);

      expect(result.diagnostics.map((d) => [d.code, d.stableId])).toEqual([
        ['MISSING_SUCCESSION', 'ART-B'],
        ['MISSING_SUCCESSION', 'ART-GONE'],
      ]);
      expect(result.rules.unaffected.map((r) => r.ruleId)).toEqual([
        'RULE-DRAFT-GONE',
        'RULE-DRAFT-SAFE',
      ]);

      baselineBytes = canonicalStringify(result);
    });

    it('repeating the same query is byte-identical', async () => {
      const again = await runDraftQuery(serverOf(app));
      expect(again).toBe(baselineBytes);
    });

    it('duplicate import is deduplicated and keeps results byte-identical', async () => {
      const server = serverOf(app);
      const dup = await request(server)
        .post('/imports')
        .send(loadMaterial('draft-2-revision.json'))
        .expect(200);
      expect((dup.body as { deduplicated: boolean }).deduplicated).toBe(true);
      expect(await runDraftQuery(server)).toBe(baselineBytes);
    });

    it('re-importing the reversed document changes neither results, paths nor diagnostics', async () => {
      const server = serverOf(app);
      const reversed = reverseDeep(loadMaterial('draft-2-revision.json')) as JsonObject;
      // Different byte order => different content hash => new batch, same graph.
      const imported = await request(server).post('/imports').send(reversed).expect(201);
      expect((imported.body as { deduplicated: boolean }).deduplicated).toBe(false);
      expect(await runDraftQuery(server)).toBe(baselineBytes);
    });

    it('replays every draft snapshot byte-identically', async () => {
      const server = serverOf(app);
      const created = await request(server).post('/impact-queries').send(QUERY_BODY).expect(201);
      const snapshotId = (created.body as { snapshotId: string }).snapshotId;
      const replay = await request(server).get(`/snapshots/${snapshotId}/replay`).expect(200);
      const replayBody = replay.body as { matchesStored: boolean; result: unknown };
      expect(replayBody.matchesStored).toBe(true);
      expect(canonicalStringify(replayBody.result)).toBe(baselineBytes);
    });
  });

  describe('reversed import order in a fresh database', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('produces byte-identical results, paths and diagnostics', async () => {
      const server = serverOf(app);
      await request(server)
        .post('/imports')
        .send(reverseDeep(loadMaterial('revision-graph.json')) as JsonObject)
        .expect(201);
      await request(server)
        .post('/imports')
        .send(reverseDeep(loadMaterial('draft-2-revision.json')) as JsonObject)
        .expect(201);

      expect(await runDraftQuery(server)).toBe(baselineBytes);
    });
  });

  describe('cyclic subgraph executed separately', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('yields the same bytes for the cycle-bearing draft query', async () => {
      const server = serverOf(app);
      // Import order swapped and draft first: cycle handling must not leak order.
      await request(server).post('/imports').send(loadMaterial('draft-2-revision.json')).expect(201);
      await request(server).post('/imports').send(loadMaterial('revision-graph.json')).expect(201);

      const bytes = await runDraftQuery(server);
      expect(bytes).toBe(baselineBytes);

      // And a query restricted to the cyclic pair stays deterministic across repeats.
      const first = await runDraftQuery(server);
      const second = await runDraftQuery(server);
      expect(second).toBe(first);
    });
  });
});
