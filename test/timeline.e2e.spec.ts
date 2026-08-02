import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { canonicalStringify } from '../src/common/canonical-json';

process.env['DATABASE_PATH'] = ':memory:';

type JsonObject = Record<string, unknown>;

interface RuleImpactBody {
  ruleId: string;
  witness: { nodes: string[] } | null;
  witnessCount: number;
}

interface ImpactResultBody {
  versionContext: {
    from: { id: string; effectivenessAtAsOf: string };
    to: { id: string; status: string; effectiveFrom: string | null; effectivenessAtAsOf: string };
  };
  rules: { direct: RuleImpactBody[]; indirect: RuleImpactBody[]; unaffected: RuleImpactBody[] };
  diagnostics: { code: string; stableId: string; boundRuleIds: string[] }[];
  paths: { ruleId: string; nodes: string[] }[];
}

interface QueryResponseBody {
  snapshotId: string;
  graphHash: string;
  result: ImpactResultBody;
}

function loadMaterial(name: string): JsonObject {
  const raw = readFileSync(join(__dirname, '..', 'materials', name), 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('material document must be a JSON object');
  }
  return parsed as JsonObject;
}

describe('timeline queries around a retroactively recorded edge (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  const DRAFT_QUERY = { fromVersion: 'LAW-V1', toVersion: 'LAW-DRAFT-2', asOf: '2026-06-01T00:00:00.000Z' };
  const PUBLISHED_QUERY = { fromVersion: 'LAW-V1', toVersion: 'LAW-V2', asOf: '2026-12-31T00:00:00.000Z' };
  const EFFECTIVE_QUERY = { fromVersion: 'LAW-V1', toVersion: 'LAW-V2', asOf: '2027-08-01T00:00:00.000Z' };

  let t1: QueryResponseBody;
  let t1Bytes: string;
  let t2: QueryResponseBody;
  let t3: QueryResponseBody;
  let t4: QueryResponseBody;

  async function runQuery(body: JsonObject): Promise<QueryResponseBody> {
    const response = await request(server).post('/impact-queries').send(body).expect(201);
    return response.body as QueryResponseBody;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;

    await request(server).post('/imports').send(loadMaterial('revision-graph.json')).expect(201);
    await request(server).post('/imports').send(loadMaterial('draft-2-revision.json')).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('T1 draft period: missing edge diagnosed, bound rule unaffected, graph hash bound', async () => {
    t1 = await runQuery(DRAFT_QUERY as unknown as JsonObject);
    t1Bytes = canonicalStringify(t1.result);

    expect(t1.result.versionContext.to.effectivenessAtAsOf).toBe('DRAFT');
    expect(t1.result.versionContext.from.effectivenessAtAsOf).toBe('EFFECTIVE');
    expect(t1.result.diagnostics.map((d) => d.stableId)).toEqual(['ART-B', 'ART-GONE']);
    expect(t1.result.rules.unaffected.map((r) => r.ruleId)).toContain('RULE-DRAFT-GONE');
    expect(t1.graphHash).toMatch(/^[0-9a-f]{64}$/);

    // Repeat: identical hash and bytes (consistent cached read).
    const repeat = await runQuery(DRAFT_QUERY as unknown as JsonObject);
    expect(repeat.graphHash).toBe(t1.graphHash);
    expect(canonicalStringify(repeat.result)).toBe(t1Bytes);
  });

  it('T2 published-not-effective stays distinct from effective queries', async () => {
    t2 = await runQuery(PUBLISHED_QUERY as unknown as JsonObject);

    expect(t2.result.versionContext.to).toEqual({
      id: 'LAW-V2',
      status: 'PUBLISHED',
      effectiveFrom: '2027-01-01',
      effectivenessAtAsOf: 'NOT_YET_EFFECTIVE',
    });
    // ART-GONE is still missing into LAW-V2 at this point.
    expect(t2.result.diagnostics.map((d) => d.stableId)).toContain('ART-GONE');
    // Same graph as T1: identical graph hash, different query binding.
    expect(t2.graphHash).toBe(t1.graphHash);
  });

  it('imports the amendments: effective-date change, cross-references, retroactive edge', async () => {
    const response = await request(server)
      .post('/imports')
      .send(loadMaterial('v2-amendments.json'))
      .expect(201);
    expect((response.body as { deduplicated: boolean }).deduplicated).toBe(false);
  });

  it('T3 after effectiveness: derived status flipped, retroactive edge in effect', async () => {
    t3 = await runQuery(EFFECTIVE_QUERY as unknown as JsonObject);

    expect(t3.result.versionContext.to).toEqual({
      id: 'LAW-V2',
      status: 'PUBLISHED',
      effectiveFrom: '2027-07-01',
      effectivenessAtAsOf: 'EFFECTIVE',
    });
    // Retroactive edge resolved ART-GONE: no diagnostic, rule now DIRECT.
    expect(t3.result.diagnostics.map((d) => d.stableId)).not.toContain('ART-GONE');
    expect(t3.result.rules.direct.map((r) => r.ruleId)).toContain('RULE-DRAFT-GONE');
    // New indirect impact through the retroactive edge: ART-N cites ART-GONE.
    const ruleN = t3.result.rules.indirect.find((r) => r.ruleId === 'RULE-N');
    expect(ruleN?.witness?.nodes).toEqual(['ART-GONE', 'ART-N']);
    expect(ruleN?.witnessCount).toBe(1);
    // Cache invalidation: the post-import query observes a new graph.
    expect(t3.graphHash).not.toBe(t2.graphHash);
  });

  it('T4 post-recording draft query: same asOf as T1, new graph content', async () => {
    t4 = await runQuery(DRAFT_QUERY as unknown as JsonObject);

    expect(t4.result.diagnostics.map((d) => d.stableId)).toEqual(['ART-B']);
    expect(t4.result.rules.direct.map((r) => r.ruleId)).toContain('RULE-DRAFT-GONE');
    expect(t4.result.rules.indirect.map((r) => r.ruleId)).toEqual([
      'RULE-DRAFT-OBS',
      'RULE-N',
      'RULE-SERVICE-02',
    ]);
    expect(t4.graphHash).not.toBe(t1.graphHash);
    expect(t4.graphHash).toBe(t3.graphHash);

    // The cross-reference cycle still terminates with two equal witnesses.
    const obs = t4.result.rules.indirect.find((r) => r.ruleId === 'RULE-DRAFT-OBS');
    expect(obs?.witness?.nodes).toEqual(['ART-C1', 'ART-OBS']);
    expect(obs?.witnessCount).toBe(2);
    expect(t4.result.paths.filter((p) => p.ruleId === 'RULE-DRAFT-OBS')).toHaveLength(4);
  });

  it('proves zero drift: pre-recording diagnostics and snapshot replays are frozen', async () => {
    // T1 replay: the pre-recording missing-edge diagnostic must not drift.
    const replay1 = await request(server).get(`/snapshots/${t1.snapshotId}/replay`).expect(200);
    const body1 = replay1.body as {
      graphHash: string;
      matchesStored: boolean;
      result: ImpactResultBody;
    };
    expect(body1.matchesStored).toBe(true);
    expect(body1.graphHash).toBe(t1.graphHash);
    expect(body1.result.diagnostics.map((d) => d.stableId)).toEqual(['ART-B', 'ART-GONE']);
    expect(body1.result.rules.unaffected.map((r) => r.ruleId)).toContain('RULE-DRAFT-GONE');
    expect(canonicalStringify(body1.result)).toBe(t1Bytes);

    // T2 replay: published-not-effective reading survives the later
    // effective-date change untouched.
    const replay2 = await request(server).get(`/snapshots/${t2.snapshotId}/replay`).expect(200);
    const body2 = replay2.body as {
      graphHash: string;
      matchesStored: boolean;
      result: ImpactResultBody;
    };
    expect(body2.matchesStored).toBe(true);
    expect(body2.graphHash).toBe(t2.graphHash);
    expect(body2.result.versionContext.to).toEqual({
      id: 'LAW-V2',
      status: 'PUBLISHED',
      effectiveFrom: '2027-01-01',
      effectivenessAtAsOf: 'NOT_YET_EFFECTIVE',
    });
    expect(body2.result.diagnostics.map((d) => d.stableId)).toContain('ART-GONE');
  });

  it('keeps same-day versions distinct and stably ordered', async () => {
    const versions = await request(server).get('/versions').expect(200);
    const list = (versions.body as { versions: { id: string; effectiveFrom: string | null }[] })
      .versions;
    const sameDay = list.filter((v) => v.effectiveFrom === '2027-07-01').map((v) => v.id);
    expect(sameDay).toEqual(['LAW-V2', 'LAW-V2-HOTFIX']);

    const hotfix = await runQuery({
      fromVersion: 'LAW-V1',
      toVersion: 'LAW-V2-HOTFIX',
      asOf: '2027-08-01T00:00:00.000Z',
    } as unknown as JsonObject);
    expect(hotfix.result.versionContext.to).toEqual({
      id: 'LAW-V2-HOTFIX',
      status: 'PUBLISHED',
      effectiveFrom: '2027-07-01',
      effectivenessAtAsOf: 'EFFECTIVE',
    });
    // Same effective day and same graph, but a different version binding:
    // results are distinct yet deterministic across repeats.
    expect(canonicalStringify(hotfix.result)).not.toBe(canonicalStringify(t3.result));
    expect(hotfix.graphHash).toBe(t3.graphHash);
    const hotfixRepeat = await runQuery({
      fromVersion: 'LAW-V1',
      toVersion: 'LAW-V2-HOTFIX',
      asOf: '2027-08-01T00:00:00.000Z',
    } as unknown as JsonObject);
    expect(canonicalStringify(hotfixRepeat.result)).toBe(canonicalStringify(hotfix.result));
  });

  it('serves every timeline snapshot from GET /snapshots/:id with frozen binding', async () => {
    const view = await request(server).get(`/snapshots/${t4.snapshotId}`).expect(200);
    const body = view.body as {
      query: { asOf: string; toVersion: string };
      graphHash: string;
      traversedEdges: { fromId: string; toId: string; kind: string }[];
    };
    expect(body.query.asOf).toBe('2026-06-01T00:00:00.000Z');
    expect(body.query.toVersion).toBe('LAW-DRAFT-2');
    expect(body.graphHash).toBe(t4.graphHash);
    // The retroactively recorded edge is part of T4's traversed edges…
    expect(body.traversedEdges).toContainEqual({
      fromId: 'ART-GONE',
      toId: 'ART-G1',
      kind: 'SUCCESSION',
    });
    // …but not of T1's frozen traversed edges.
    const view1 = await request(server).get(`/snapshots/${t1.snapshotId}`).expect(200);
    expect(
      (view1.body as { traversedEdges: { fromId: string }[] }).traversedEdges.map((e) => e.fromId),
    ).not.toContain('ART-GONE');
  });
});
