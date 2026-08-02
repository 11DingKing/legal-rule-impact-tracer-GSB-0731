import { Injectable, NotFoundException } from '@nestjs/common';
import { canonicalStringify } from '../common/canonical-json';
import { computeImpact } from '../domain/impact';
import { SnapshotRepository } from '../persistence/snapshot.repository';
import type { SnapshotRecord } from '../persistence/snapshot.repository';
import type { ImpactQuery, ImpactResult, PathEdge, RevisionGraph } from '../domain/types';

export interface SnapshotView {
  readonly id: string;
  readonly createdAt: string;
  readonly query: ImpactQuery;
  readonly graphHash: string;
  readonly result: ImpactResult;
  readonly traversedEdges: readonly PathEdge[];
}

export interface ReplayResult {
  readonly snapshotId: string;
  readonly replayedAt: string;
  readonly graphHash: string;
  /** True when recomputing from the frozen graph reproduces the stored bytes. */
  readonly matchesStored: boolean;
  readonly result: ImpactResult;
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

/**
 * Reads immutable snapshots and replays them.
 *
 * Replay recomputes the impact from the *frozen* graph and query embedded in
 * the snapshot — never the live graph — and compares the canonical bytes to
 * the stored result. This is what guarantees that adding edges or editing
 * labels afterwards cannot make an old snapshot replay differently.
 */
@Injectable()
export class SnapshotsService {
  constructor(private readonly snapshots: SnapshotRepository) {}

  getSnapshot(id: string): SnapshotView {
    const record = this.requireRecord(id);
    const result = parseJson<ImpactResult>(record.resultJson);
    return {
      id: record.id,
      createdAt: record.createdAt,
      query: parseJson<ImpactQuery>(record.queryJson),
      graphHash: record.graphHash,
      result,
      traversedEdges: result.traversedEdges,
    };
  }

  replay(id: string): ReplayResult {
    const record = this.requireRecord(id);
    const frozenGraph = parseJson<RevisionGraph>(record.graphJson);
    const frozenQuery = parseJson<ImpactQuery>(record.queryJson);
    const recomputed = computeImpact(frozenGraph, frozenQuery);
    const matchesStored = canonicalStringify(recomputed) === record.resultJson;
    const stored = parseJson<ImpactResult>(record.resultJson);
    return {
      snapshotId: record.id,
      replayedAt: new Date().toISOString(),
      graphHash: record.graphHash,
      matchesStored,
      result: matchesStored ? recomputed : stored,
    };
  }

  private requireRecord(id: string): SnapshotRecord {
    const record = this.snapshots.findById(id);
    if (record === null) {
      throw new NotFoundException(`Unknown snapshot: ${id}`);
    }
    return record;
  }
}
