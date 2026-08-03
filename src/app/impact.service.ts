import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ImpactQuery,
  ImpactResult,
  Snapshot,
} from '../domain';
import { createSnapshot, replaySnapshot } from '../domain';
import { RevisionRepository } from '../infra/database/revision.repository';
import { GraphAssembler } from './graph.assembler';

interface CachedEntry {
  readonly graphHash: string;
  readonly snapshotId: string;
  readonly result: ImpactResult;
}

@Injectable()
export class ImpactService {
  private readonly cache = new Map<string, CachedEntry>();

  constructor(
    private readonly repo: RevisionRepository,
    private readonly assembler: GraphAssembler,
  ) {}

  queryImpact(query: ImpactQuery): { result: ImpactResult; snapshot: Snapshot; cacheHit: boolean } {
    const graph = this.assembler.assemble();
    if (!graph.versions.has(query.fromVersionId)) {
      throw new NotFoundException(
        `Version not found: ${query.fromVersionId}`,
      );
    }
    if (!graph.versions.has(query.toVersionId)) {
      throw new NotFoundException(`Version not found: ${query.toVersionId}`);
    }

    const probe = createSnapshot({
      graph,
      query,
      createdAt: 'PROBE-0000-0000',
    });
    const cacheKey = `${probe.graphHash}\u0000${probe.result.context.graphHash}\u0000${query.fromVersionId}\u0000${query.toVersionId}\u0000${query.queryAt}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.graphHash === probe.graphHash) {
      const existing = this.repo.loadSnapshot(cached.snapshotId);
      if (existing) {
        return {
          result: cached.result,
          snapshot: this.getSnapshot(cached.snapshotId),
          cacheHit: true,
        };
      }
    }

    const snapshot = createSnapshot({ graph, query });
    this.persistSnapshot(snapshot);
    this.cache.set(cacheKey, {
      graphHash: snapshot.graphHash,
      snapshotId: snapshot.id,
      result: snapshot.result,
    });
    return { result: snapshot.result, snapshot, cacheHit: false };
  }

  getCacheStats(): { size: number } {
    return { size: this.cache.size };
  }

  clearCache(): void {
    this.cache.clear();
  }

  getSnapshot(id: string): Snapshot {
    const row = this.repo.loadSnapshot(id);
    if (!row) throw new NotFoundException(`Snapshot not found: ${id}`);
    return deserializeSnapshot(row);
  }

  replaySnapshot(id: string): ImpactResult {
    const snap = this.getSnapshot(id);
    return replaySnapshot(snap);
  }

  listSnapshots(): ReadonlyArray<{
    id: string;
    createdAt: string;
    graphHash: string;
  }> {
    return this.repo.listSnapshots().map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      graphHash: r.graph_hash,
    }));
  }

  private persistSnapshot(snap: Snapshot): void {
    this.repo.saveSnapshot(
      snap.id,
      snap.createdAt,
      JSON.stringify(snap.query),
      snap.graphHash,
      JSON.stringify(snap.frozenVersions),
      JSON.stringify(snap.frozenArticles),
      JSON.stringify(snap.frozenEdges),
      JSON.stringify(snap.frozenRules),
      JSON.stringify(snap.result),
    );
  }
}

interface SnapshotRow {
  readonly id: string;
  readonly created_at: string;
  readonly query_json: string;
  readonly graph_hash: string;
  readonly frozen_versions_json: string;
  readonly frozen_articles_json: string;
  readonly frozen_edges_json: string;
  readonly frozen_rules_json: string;
  readonly result_json: string;
}

function deserializeSnapshot(row: SnapshotRow): Snapshot {
  return Object.freeze({
    id: row.id,
    createdAt: row.created_at,
    query: JSON.parse(row.query_json) as ImpactQuery,
    graphHash: row.graph_hash,
    frozenVersions: Object.freeze(JSON.parse(row.frozen_versions_json)),
    frozenArticles: Object.freeze(JSON.parse(row.frozen_articles_json)),
    frozenEdges: Object.freeze(JSON.parse(row.frozen_edges_json)),
    frozenRules: Object.freeze(JSON.parse(row.frozen_rules_json)),
    result: Object.freeze(JSON.parse(row.result_json)) as ImpactResult,
  });
}
