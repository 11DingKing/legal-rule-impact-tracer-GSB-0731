import { ArticleStableId } from '../models/branded-types';
import { EdgeKind } from '../models/enums';
import { PathHop, PropagationPath } from '../models/propagation-path';
import { ReadOnlyRevisionGraph } from '../models/revision-graph';
import { getOrderedNeighbors } from './graph-neighbors';

export interface ShortestPathInfo {
  readonly distance: number;
  readonly equalLengthPathCount: number;
  readonly witness: PropagationPath;
}

interface PredecessorRecord {
  readonly fromId: ArticleStableId;
  readonly edgeKind: EdgeKind;
  readonly detail: string;
}

export class ShortestPathCalculator {
  calculate(
    graph: ReadOnlyRevisionGraph,
    seedIds: readonly ArticleStableId[],
  ): ReadonlyMap<ArticleStableId, ShortestPathInfo> {
    const distances = new Map<ArticleStableId, number>();
    const counts = new Map<ArticleStableId, number>();
    const predecessors = new Map<
      ArticleStableId,
      PredecessorRecord
    >();

    const sortedSeeds = [...seedIds].sort((a, b) =>
      a.localeCompare(b),
    );
    let currentLevel: ArticleStableId[] = [];
    for (const seed of sortedSeeds) {
      if (!distances.has(seed)) {
        distances.set(seed, 0);
        counts.set(seed, 1);
        currentLevel.push(seed);
      }
    }

    while (currentLevel.length > 0) {
      const nextLevelSet = new Map<ArticleStableId, ArticleStableId>();
      const currentDistance = distances.get(currentLevel[0]!)!;

      for (const node of currentLevel) {
        const nodeCount = counts.get(node) ?? 0;
        const neighbors = getOrderedNeighbors(graph, node);

        for (const neighbor of neighbors) {
          const existingDist = distances.get(neighbor.id);

          if (existingDist === undefined) {
            distances.set(neighbor.id, currentDistance + 1);
            counts.set(neighbor.id, nodeCount);
            predecessors.set(neighbor.id, {
              fromId: node,
              edgeKind: neighbor.edgeKind,
              detail: neighbor.detail,
            });
            nextLevelSet.set(neighbor.id, neighbor.id);
          } else if (existingDist === currentDistance + 1) {
            counts.set(
              neighbor.id,
              (counts.get(neighbor.id) ?? 0) + nodeCount,
            );
          }
        }
      }

      currentLevel = [...nextLevelSet.values()].sort((a, b) =>
        a.localeCompare(b),
      );
    }

    const result = new Map<ArticleStableId, ShortestPathInfo>();
    for (const [id, distance] of distances) {
      const witness = this.reconstructWitness(
        id,
        distance,
        predecessors,
      );
      result.set(id, {
        distance,
        equalLengthPathCount: counts.get(id) ?? 0,
        witness,
      });
    }
    return result;
  }

  private reconstructWitness(
    targetId: ArticleStableId,
    distance: number,
    predecessors: ReadonlyMap<ArticleStableId, PredecessorRecord>,
  ): PropagationPath {
    if (distance === 0) {
      return { hops: [], targetId, depth: 0 };
    }

    const hops: PathHop[] = [];
    let current: ArticleStableId = targetId;
    for (let i = 0; i < distance; i++) {
      const pred = predecessors.get(current);
      if (!pred) break;
      hops.unshift({
        edgeKind: pred.edgeKind,
        fromId: pred.fromId,
        toId: current,
        detail: pred.detail,
      });
      current = pred.fromId;
    }
    return { hops, targetId, depth: distance };
  }
}
