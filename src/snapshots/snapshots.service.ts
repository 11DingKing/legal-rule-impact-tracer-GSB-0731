import { Injectable, NotFoundException } from "@nestjs/common";
import { canonicalStringify } from "../common/canonical-json";
import { computeImpact } from "../domain/impact";
import type { ImpactQuery, ImpactResult, RevisionGraph } from "../domain/types";
import {
  SnapshotRepository,
  type SnapshotRecord,
} from "../persistence/snapshot.repository";

export interface SnapshotView {
  readonly id: string;
  readonly createdAt: string;
  readonly query: ImpactQuery;
  readonly graphHash: string;
  readonly result: ImpactResult;
  readonly traversedEdges: ImpactResult["traversedEdges"];
}

export interface ReplayResult {
  readonly snapshotId: string;
  readonly replayedAt: string;
  /** Hash of the graph slice frozen into the snapshot. */
  readonly graphHash: string;
  /** True when recomputation from the frozen graph reproduces the stored result. */
  readonly matchesStored: boolean;
  readonly result: ImpactResult;
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

@Injectable()
export class SnapshotsService {
  constructor(private readonly snapshots: SnapshotRepository) {}

  getSnapshot(id: string): SnapshotView {
    const record = this.requireRecord(id);
    const result = parseJson(record.resultJson) as ImpactResult;
    return {
      id: record.id,
      createdAt: record.createdAt,
      query: parseJson(record.queryJson) as ImpactQuery,
      graphHash: record.graphHash,
      result,
      traversedEdges: result.traversedEdges,
    };
  }

  /**
   * Replay never consults the live tables. It recomputes the impact solely
   * from the graph slice frozen into the snapshot, then byte-compares the
   * canonical serialization with the stored result. Later imports of new
   * succession edges or label changes therefore cannot alter the replay.
   */
  replay(id: string): ReplayResult {
    const record = this.requireRecord(id);
    const frozenGraph = parseJson(record.graphJson) as RevisionGraph;
    const frozenQuery = parseJson(record.queryJson) as ImpactQuery;
    const recomputed = computeImpact(frozenGraph, frozenQuery);
    const matchesStored = canonicalStringify(recomputed) === record.resultJson;
    const stored = parseJson(record.resultJson) as ImpactResult;
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
