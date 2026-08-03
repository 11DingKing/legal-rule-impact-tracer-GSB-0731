import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseService } from '../persistence/database.service';
import { GraphRepository } from '../persistence/graph.repository';
import { ImportRepository } from '../persistence/import.repository';
import { SnapshotRepository } from '../persistence/snapshot.repository';
import { ImportsService } from '../imports/imports.service';
import { ImpactService } from './impact.service';
import { SnapshotsService } from '../snapshots/snapshots.service';

/**
 * Round-3 lifecycle scenario. It wires the real services over an in-memory
 * SQLite database and walks a revision through four query instants:
 *
 *   1. draft period                (LAW-DRAFT-2 is DRAFT)
 *   2. published, not yet effective (asOf < LAW-V2.effectiveFrom)
 *   3. effective                   (asOf >= LAW-V2.effectiveFrom)
 *   4. after a backfilled edge      (a succession edge added post-hoc)
 *
 * Each query is frozen into a snapshot binding the law versions, the query
 * instant, the graph-snapshot hash, and the traversed propagation edges. The
 * tests prove that backfilling the previously-missing ART-ORPH -> ART-ORPH2
 * succession edge changes only *new* snapshots: the pre-backfill missing-edge
 * diagnostic and every earlier snapshot replay stay drift-free.
 */

const MATERIALS = join(__dirname, '..', '..', 'materials');

function readMaterial(name: string): unknown {
  return JSON.parse(readFileSync(join(MATERIALS, name), 'utf8'));
}

const T_DRAFT = '2026-08-02T00:00:00.000Z';
const T_PUBLISHED_NOT_EFFECTIVE = '2026-12-31T00:00:00.000Z';
const T_EFFECTIVE = '2027-06-01T00:00:00.000Z';
const T_AFTER_BACKFILL = '2027-06-02T00:00:00.000Z';

interface Harness {
  readonly database: DatabaseService;
  readonly imports: ImportsService;
  readonly impact: ImpactService;
  readonly snapshots: SnapshotsService;
}

function newHarness(): Harness {
  process.env['DATABASE_PATH'] = ':memory:';
  const database = new DatabaseService();
  database.onModuleInit();
  const graphRepo = new GraphRepository(database);
  const importRepo = new ImportRepository(database);
  const snapshotRepo = new SnapshotRepository(database);
  return {
    database,
    imports: new ImportsService(importRepo, graphRepo),
    impact: new ImpactService(graphRepo, snapshotRepo),
    snapshots: new SnapshotsService(snapshotRepo),
  };
}

describe('Revision lifecycle across four time points with a post-hoc backfill', () => {
  let h: Harness;

  beforeEach(() => {
    h = newHarness();
    h.imports.importDocument(readMaterial('lifecycle-revision.json'));
  });

  afterEach(() => {
    h.database.onModuleDestroy();
  });

  function query(asOf: string): ReturnType<ImpactService['runQuery']> {
    return h.impact.runQuery({
      fromVersion: 'LAW-V1',
      toVersion: 'LAW-V2',
      asOf,
    });
  }

  it('binds version, instant, graph hash and traversed edges into every snapshot', () => {
    const draft = query(T_DRAFT);
    const view = h.snapshots.getSnapshot(draft.snapshotId);

    expect(view.query).toEqual({
      fromVersion: 'LAW-V1',
      toVersion: 'LAW-V2',
      asOf: T_DRAFT,
    });
    expect(view.graphHash).toBe(draft.graphHash);
    expect(view.graphHash).toMatch(/^[0-9a-f]{64}$/);
    // Traversed edges bound to the snapshot: the RENUMBER successions plus the
    // reverse-reference edges walked for the indirect rules.
    expect(view.traversedEdges).toEqual(view.result.traversedEdges);
    expect(view.traversedEdges).toContainEqual({
      fromId: 'ART-A',
      toId: 'ART-A2',
      kind: 'SUCCESSION',
    });
    expect(view.traversedEdges).toContainEqual({
      fromId: 'ART-C1',
      toId: 'ART-CITE',
      kind: 'REFERENCE_REVERSE',
    });
  });

  it('distinguishes the four query instants by version effectiveness', () => {
    const draft = query(T_DRAFT);
    const notYet = query(T_PUBLISHED_NOT_EFFECTIVE);
    const effective = query(T_EFFECTIVE);

    expect(draft.result.versionContext.to.effectivenessAtAsOf).toBe(
      'NOT_YET_EFFECTIVE',
    );
    expect(notYet.result.versionContext.to.effectivenessAtAsOf).toBe(
      'NOT_YET_EFFECTIVE',
    );
    expect(effective.result.versionContext.to.effectivenessAtAsOf).toBe(
      'EFFECTIVE',
    );
    expect(effective.result.versionContext.from.effectivenessAtAsOf).toBe(
      'EFFECTIVE',
    );

    // The published-not-yet-effective instant differs from the effective one
    // only in version context; the derived impact set is identical.
    expect(notYet.result.rules).toEqual(effective.result.rules);
    // Distinct instants must yield distinct snapshots.
    expect(new Set([draft.snapshotId, notYet.snapshotId, effective.snapshotId]).size).toBe(3);
  });

  it('reports the missing succession edge before backfill and classifies ART-ORPH after', () => {
    const before = query(T_EFFECTIVE);
    expect(before.result.missingSuccession).toEqual([
      { stableId: 'ART-ORPH', boundRuleIds: ['RULE-ORPH'] },
    ]);
    expect(before.result.rules.unaffected.map((r) => r.ruleId)).toContain(
      'RULE-ORPH',
    );

    // Backfill the previously-missing edge, then query again.
    h.imports.importDocument(readMaterial('lifecycle-backfill.json'));
    const after = query(T_AFTER_BACKFILL);

    expect(after.result.missingSuccession).toEqual([]);
    expect(after.result.changedArticles.map((c) => c.stableId)).toContain(
      'ART-ORPH',
    );
    expect(after.result.rules.direct.map((r) => r.ruleId)).toContain('RULE-ORPH');
    // The backfill changed the stored graph, so the hash moves forward.
    expect(after.graphHash).not.toBe(before.graphHash);
  });

  it('backfill affects only new snapshots: earlier snapshots replay without drift', () => {
    const draft = query(T_DRAFT);
    const notYet = query(T_PUBLISHED_NOT_EFFECTIVE);
    const effective = query(T_EFFECTIVE);

    const preHashes = {
      draft: draft.graphHash,
      notYet: notYet.graphHash,
      effective: effective.graphHash,
    };
    const preResults = {
      draft: h.snapshots.getSnapshot(draft.snapshotId).result,
      notYet: h.snapshots.getSnapshot(notYet.snapshotId).result,
      effective: h.snapshots.getSnapshot(effective.snapshotId).result,
    };

    // Post-hoc backfill of the missing edge.
    h.imports.importDocument(readMaterial('lifecycle-backfill.json'));
    const after = query(T_AFTER_BACKFILL);

    // The new snapshot sees the backfilled edge...
    expect(after.result.missingSuccession).toEqual([]);
    // ...but replaying each earlier snapshot reproduces its frozen result
    // byte-for-byte, from the graph frozen inside that snapshot.
    for (const [id, frozen] of [
      [draft.snapshotId, preResults.draft],
      [notYet.snapshotId, preResults.notYet],
      [effective.snapshotId, preResults.effective],
    ] as const) {
      const replay = h.snapshots.replay(id);
      expect(replay.matchesStored).toBe(true);
      expect(replay.result).toEqual(frozen);
      expect(replay.result.missingSuccession).toEqual([
        { stableId: 'ART-ORPH', boundRuleIds: ['RULE-ORPH'] },
      ]);
    }

    // Frozen graph hashes are unchanged by the later backfill.
    expect(h.snapshots.getSnapshot(draft.snapshotId).graphHash).toBe(preHashes.draft);
    expect(h.snapshots.getSnapshot(notYet.snapshotId).graphHash).toBe(
      preHashes.notYet,
    );
    expect(h.snapshots.getSnapshot(effective.snapshotId).graphHash).toBe(
      preHashes.effective,
    );
    // The pre-backfill snapshots share one graph; the post-backfill one differs.
    expect(preHashes.draft).toBe(preHashes.effective);
    expect(after.graphHash).not.toBe(preHashes.effective);
  });

  it('keeps same-day versions with identical effective dates distinct', () => {
    // LAW-V2 and LAW-V2-ALT are both PUBLISHED with effectiveFrom 2027-01-01.
    const preEffective = h.impact.runQuery({
      fromVersion: 'LAW-V2',
      toVersion: 'LAW-V2-ALT',
      asOf: T_PUBLISHED_NOT_EFFECTIVE,
    });
    expect(preEffective.result.versionContext.from.id).toBe('LAW-V2');
    expect(preEffective.result.versionContext.to.id).toBe('LAW-V2-ALT');
    expect(preEffective.result.versionContext.from.effectivenessAtAsOf).toBe(
      'NOT_YET_EFFECTIVE',
    );
    expect(preEffective.result.versionContext.to.effectivenessAtAsOf).toBe(
      'NOT_YET_EFFECTIVE',
    );
    // No succession between the two same-day siblings: identity is not guessed.
    expect(preEffective.result.changedArticles).toEqual([]);

    const onEffectiveDay = h.impact.runQuery({
      fromVersion: 'LAW-V2',
      toVersion: 'LAW-V2-ALT',
      asOf: T_EFFECTIVE,
    });
    expect(onEffectiveDay.result.versionContext.to.effectivenessAtAsOf).toBe(
      'EFFECTIVE',
    );
    // Distinct instants over the same version pair are distinct snapshots.
    expect(preEffective.snapshotId).not.toBe(onEffectiveDay.snapshotId);
  });

  it('terminates on the cross-reference cycle and reports each citer once', () => {
    const result = query(T_DRAFT).result;
    // ART-C1 <-> ART-C2 is a cycle; RULE-CITE cites ART-C1. Paths are simple,
    // deduplicated, and stably sorted, so the cycle cannot loop forever.
    const citePaths = result.paths
      .filter((p) => p.ruleId === 'RULE-CITE')
      .map((p) => p.nodes.join('>'));
    expect(citePaths).toEqual(['ART-C1>ART-CITE', 'ART-C2>ART-C1>ART-CITE']);
    expect(new Set(citePaths).size).toBe(citePaths.length);
    expect(result.rules.indirect.map((r) => r.ruleId)).toEqual([
      'RULE-B',
      'RULE-CITE',
    ]);
  });
});
