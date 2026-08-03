import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ImpactQuery,
  ImpactResult,
  Snapshot,
} from '../domain';
import { createSnapshot, replaySnapshot } from '../domain';
import { RevisionRepository } from '../infra/database/revision.repository';
import { GraphAssembler } from './graph.assembler';

@Injectable()
export class ImpactService {
  constructor(
    private readonly repo: RevisionRepository,
    private readonly assembler: GraphAssembler,
  ) {}

  queryImpact(query: ImpactQuery): { result: ImpactResult; snapshot: Snapshot } {
    const graph = this.assembler.assemble();
    if (!graph.versions.has(query.fromVersionId)) {
      throw new NotFoundException(
        `Version not found: ${query.fromVersionId}`,
      );
    }
    if (!graph.versions.has(query.toVersionId)) {
      throw new NotFoundException(`Version not found: ${query.toVersionId}`);
    }
    const snapshot = createSnapshot({ graph, query });
    this.persistSnapshot(snapshot);
    return { result: snapshot.result, snapshot };
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
