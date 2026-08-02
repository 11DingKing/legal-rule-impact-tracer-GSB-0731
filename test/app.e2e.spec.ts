import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

process.env["DATABASE_PATH"] = ":memory:";

interface ImpactQueryResponseBody {
  snapshotId: string;
  result: {
    query: { fromVersion: string; toVersion: string; asOf: string };
    rules: {
      direct: { ruleId: string; via: string[] }[];
      indirect: { ruleId: string; via: string[] }[];
      unaffected: { ruleId: string; via: string[] }[];
    };
    missingSuccession: { stableId: string; boundRuleIds: string[] }[];
    paths: { ruleId: string; impact: string; nodes: string[] }[];
    traversedEdges: { fromId: string; toId: string; kind: string }[];
  };
}

function loadMaterial(): Record<string, unknown> {
  const raw = readFileSync(
    join(__dirname, "..", "materials", "revision-graph.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("material document must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

describe("Legal Rule Impact Tracer API (e2e)", () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it("imports the material document and deduplicates a repeated import", async () => {
    const material = loadMaterial();

    const first = await request(server)
      .post("/imports")
      .send(material)
      .expect(201);
    const firstBody = first.body as {
      batchId: string;
      contentHash: string;
      deduplicated: boolean;
      counts: {
        versions: number;
        articles: number;
        successionEdges: number;
        bindings: number;
      };
    };
    expect(firstBody.deduplicated).toBe(false);
    expect(firstBody.counts).toMatchObject({
      versions: 3,
      articles: 4,
      successionEdges: 2,
    });

    const second = await request(server)
      .post("/imports")
      .send(material)
      .expect(200);
    const secondBody = second.body as {
      batchId: string;
      deduplicated: boolean;
    };
    expect(secondBody.deduplicated).toBe(true);
    expect(secondBody.batchId).toBe(firstBody.batchId);
  });

  it("rejects malformed import documents with 400", async () => {
    await request(server)
      .post("/imports")
      .send({ versions: "nope" })
      .expect(400);
    await request(server)
      .post("/imports")
      .send({
        versions: [],
        articles: [],
        succession: [{ from: "A", to: ["B"], kind: "MAYBE" }],
        bindings: [],
      })
      .expect(400);
  });

  it("answers the revision impact query with direct/indirect/unaffected sets and paths", async () => {
    const response = await request(server)
      .post("/impact-queries")
      .send({ fromVersion: "LAW-V1", toVersion: "LAW-V2" })
      .expect(201);
    const body = response.body as ImpactQueryResponseBody;

    expect(body.snapshotId).toBeTruthy();
    expect(body.result.query.fromVersion).toBe("LAW-V1");
    expect(body.result.query.asOf).toBeTruthy();
    expect(body.result.rules.direct.map((r) => r.ruleId)).toEqual([
      "RULE-ELIGIBILITY-01",
    ]);
    expect(body.result.rules.indirect.map((r) => r.ruleId)).toEqual([
      "RULE-SERVICE-02",
    ]);
    expect(body.result.rules.unaffected).toEqual([]);
    expect(body.result.missingSuccession).toEqual([
      { stableId: "ART-B", boundRuleIds: ["RULE-SERVICE-02"] },
    ]);
    expect(
      body.result.paths.find((p) => p.ruleId === "RULE-SERVICE-02")?.nodes,
    ).toEqual(["ART-A", "ART-B"]);
    expect(body.result.traversedEdges.length).toBeGreaterThan(0);
  });

  it("returns 404 with known versions for unknown from/to versions", async () => {
    const response = await request(server)
      .post("/impact-queries")
      .send({ fromVersion: "LAW-V1", toVersion: "LAW-V99" })
      .expect(404);
    const body = response.body as { knownVersions: string[] };
    expect(body.knownVersions).toContain("LAW-V1");
  });

  it("replays a snapshot identically after later imports add edges and change labels", async () => {
    const created = await request(server)
      .post("/impact-queries")
      .send({ fromVersion: "LAW-V1", toVersion: "LAW-V2" })
      .expect(201);
    const { snapshotId, result: original } =
      created.body as ImpactQueryResponseBody;

    // Later material arrives: a new succession edge for ART-B and a relabelled article.
    const laterImport = {
      versions: [
        { id: "LAW-V2", status: "PUBLISHED", effectiveFrom: "2027-01-01" },
      ],
      articles: [
        { stableId: "ART-B2", version: "LAW-V2", label: "第十四条" },
        {
          stableId: "ART-A1",
          version: "LAW-V2",
          label: "第十二条（已修订文案）",
        },
      ],
      succession: [{ from: "ART-B", to: ["ART-B2"], kind: "RENUMBER" }],
      bindings: [],
    };
    await request(server).post("/imports").send(laterImport).expect(201);

    // The live graph now answers differently: ART-B is changed, so RULE-SERVICE-02
    // becomes DIRECT for fresh queries.
    const fresh = await request(server)
      .post("/impact-queries")
      .send({ fromVersion: "LAW-V1", toVersion: "LAW-V2" })
      .expect(201);
    const freshBody = fresh.body as ImpactQueryResponseBody;
    expect(freshBody.result.rules.direct.map((r) => r.ruleId)).toContain(
      "RULE-SERVICE-02",
    );

    // The old snapshot replays from its frozen graph: identical result.
    const replay = await request(server)
      .get(`/snapshots/${snapshotId}/replay`)
      .expect(200);
    const replayBody = replay.body as {
      matchesStored: boolean;
      result: ImpactQueryResponseBody["result"];
    };
    expect(replayBody.matchesStored).toBe(true);
    expect(replayBody.result).toEqual(original);

    // Replaying the fresh snapshot reflects the new edge instead.
    const freshReplay = await request(server)
      .get(`/snapshots/${freshBody.snapshotId}/replay`)
      .expect(200);
    const freshReplayBody = freshReplay.body as { matchesStored: boolean };
    expect(freshReplayBody.matchesStored).toBe(true);
  });

  it("exposes the frozen query and traversed edges via GET /snapshots/:id", async () => {
    const created = await request(server)
      .post("/impact-queries")
      .send({
        fromVersion: "LAW-V1",
        toVersion: "LAW-DRAFT-2",
        asOf: "2026-08-02T08:00:00.000Z",
      })
      .expect(201);
    const { snapshotId } = created.body as ImpactQueryResponseBody;

    const snapshot = await request(server)
      .get(`/snapshots/${snapshotId}`)
      .expect(200);
    const body = snapshot.body as {
      query: { asOf: string; toVersion: string };
      traversedEdges: unknown[];
    };
    expect(body.query.asOf).toBe("2026-08-02T08:00:00.000Z");
    expect(body.query.toVersion).toBe("LAW-DRAFT-2");
    expect(Array.isArray(body.traversedEdges)).toBe(true);
  });

  it("lists imported versions", async () => {
    const response = await request(server).get("/versions").expect(200);
    const body = response.body as {
      versions: { id: string; status: string }[];
    };
    expect(body.versions.map((v) => v.id)).toContain("LAW-V1");
  });
});
