import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { canonicalStringify } from '../common/canonical-json';
import { computeImpact, UnknownVersionError } from '../domain/impact';
import { GraphRepository } from '../persistence/graph.repository';
import { SnapshotRepository } from '../persistence/snapshot.repository';
import type { ImpactQuery, ImpactResult } from '../domain/types';

export interface ImpactQueryResponse {
  readonly snapshotId: string;
  readonly graphHash: string;
  readonly result: ImpactResult;
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestException(`Field "${field}" must be a non-empty string`);
  }
  return value;
}

/**
 * Runs an impact query and freezes the outcome as an immutable snapshot.
 *
 * The service loads the current graph, delegates all reasoning to the pure
 * domain `computeImpact`, then persists the query, the exact graph seen, and
 * the result — each canonically serialized. Because the graph is stored inside
 * the snapshot, later edits to edges or labels can never change what this
 * snapshot replays.
 */
@Injectable()
export class ImpactService {
  constructor(
    private readonly graph: GraphRepository,
    private readonly snapshots: SnapshotRepository,
  ) {}

  runQuery(body: {
    readonly fromVersion?: unknown;
    readonly toVersion?: unknown;
    readonly asOf?: unknown;
  }): ImpactQueryResponse {
    const query: ImpactQuery = {
      fromVersion: readRequiredString(body.fromVersion, 'fromVersion'),
      toVersion: readRequiredString(body.toVersion, 'toVersion'),
      asOf:
        body.asOf === undefined
          ? new Date().toISOString()
          : readRequiredString(body.asOf, 'asOf'),
    };

    const graph = this.graph.loadGraph();
    let result: ImpactResult;
    try {
      result = computeImpact(graph, query);
    } catch (error) {
      if (error instanceof UnknownVersionError) {
        throw new NotFoundException({
          message: error.message,
          knownVersions: error.knownVersionIds,
        });
      }
      throw error;
    }

    const graphHash = createHash('sha256')
      .update(canonicalStringify(graph))
      .digest('hex');
    const snapshotId = randomUUID();
    this.snapshots.insert({
      id: snapshotId,
      createdAt: new Date().toISOString(),
      queryJson: canonicalStringify(query),
      graphJson: canonicalStringify(graph),
      resultJson: canonicalStringify(result),
      graphHash,
    });
    return { snapshotId, graphHash, result };
  }
}
