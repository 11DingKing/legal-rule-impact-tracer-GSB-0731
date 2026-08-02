import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { canonicalStringify } from "../common/canonical-json";
import { computeImpact, UnknownVersionError } from "../domain/impact";
import type { ImpactQuery, ImpactResult } from "../domain/types";
import { GraphRepository } from "../persistence/graph.repository";
import { SnapshotRepository } from "../persistence/snapshot.repository";

export interface ImpactQueryRequest {
  readonly fromVersion: unknown;
  readonly toVersion: unknown;
  readonly asOf?: unknown;
}

export interface ImpactQueryResponse {
  readonly snapshotId: string;
  /** SHA-256 over the canonical graph slice this query was evaluated against. */
  readonly graphHash: string;
  readonly result: ImpactResult;
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequestException(
      `Field "${field}" must be a non-empty string`,
    );
  }
  return value;
}

@Injectable()
export class ImpactService {
  constructor(
    private readonly graph: GraphRepository,
    private readonly snapshots: SnapshotRepository,
  ) {}

  runQuery(body: ImpactQueryRequest): ImpactQueryResponse {
    const query: ImpactQuery = {
      fromVersion: readRequiredString(body.fromVersion, "fromVersion"),
      toVersion: readRequiredString(body.toVersion, "toVersion"),
      asOf:
        body.asOf === undefined
          ? new Date().toISOString()
          : readRequiredString(body.asOf, "asOf"),
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

    // Freeze query, graph slice and result into an append-only snapshot.
    // The graph hash binds the snapshot to the exact graph content it used.
    const graphHash = createHash("sha256")
      .update(canonicalStringify(graph))
      .digest("hex");
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
