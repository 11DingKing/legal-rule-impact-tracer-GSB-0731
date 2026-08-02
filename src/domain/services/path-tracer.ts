import { ArticleStableId } from '../models/branded-types';
import { EdgeKind } from '../models/enums';
import { PathHop, PropagationPath } from '../models/propagation-path';
import { ReadOnlyRevisionGraph } from '../models/revision-graph';

export interface TraceSeed {
  readonly articleId: ArticleStableId;
  readonly reason: string;
}

export class PathTracer {
  trace(
    graph: ReadOnlyRevisionGraph,
    seeds: readonly TraceSeed[],
  ): readonly PropagationPath[] {
    const allPaths: PropagationPath[] = [];
    const seedIds = new Set(seeds.map((s) => s.articleId));

    for (const seed of seeds) {
      const visited = new Set<ArticleStableId>([seed.articleId]);
      this.dfs(graph, seed.articleId, [], visited, seedIds, allPaths);
    }

    const deduped = this.deduplicatePaths(allPaths);
    return this.sortPaths(deduped);
  }

  private dfs(
    graph: ReadOnlyRevisionGraph,
    current: ArticleStableId,
    currentHops: PathHop[],
    visited: Set<ArticleStableId>,
    seedIds: ReadonlySet<ArticleStableId>,
    output: PropagationPath[],
  ): void {
    if (currentHops.length > 0) {
      output.push({
        hops: [...currentHops],
        targetId: current,
        depth: currentHops.length,
      });
    } else if (seedIds.has(current)) {
      output.push({
        hops: [],
        targetId: current,
        depth: 0,
      });
    }

    const neighbors = this.getOrderedNeighbors(graph, current);

    for (const neighbor of neighbors) {
      if (visited.has(neighbor.id)) {
        continue;
      }
      visited.add(neighbor.id);
      const hop: PathHop = {
        edgeKind: neighbor.edgeKind,
        fromId: current,
        toId: neighbor.id,
        detail: neighbor.detail,
      };
      currentHops.push(hop);
      this.dfs(
        graph,
        neighbor.id,
        currentHops,
        visited,
        seedIds,
        output,
      );
      currentHops.pop();
      visited.delete(neighbor.id);
    }
  }

  private getOrderedNeighbors(
    graph: ReadOnlyRevisionGraph,
    articleId: ArticleStableId,
  ): { id: ArticleStableId; edgeKind: EdgeKind; detail: string }[] {
    const neighbors: {
      id: ArticleStableId;
      edgeKind: EdgeKind;
      detail: string;
    }[] = [];

    const successionEdges = graph.getSuccessionsFrom(articleId);
    for (const edge of successionEdges) {
      for (const toId of edge.toStableIds) {
        neighbors.push({
          id: toId,
          edgeKind: EdgeKind.SUCCESSION,
          detail: `${edge.kind}: ${articleId} -> ${toId}`,
        });
      }
    }

    const reverseRefs = graph.getReverseReferences(articleId);
    for (const refId of reverseRefs) {
      neighbors.push({
        id: refId,
        edgeKind: EdgeKind.CROSS_REFERENCE,
        detail: `${refId} references ${articleId}`,
      });
    }

    neighbors.sort((a, b) => {
      if (a.edgeKind !== b.edgeKind) {
        return a.edgeKind.localeCompare(b.edgeKind);
      }
      return a.id.localeCompare(b.id);
    });

    return neighbors;
  }

  private deduplicatePaths(
    paths: readonly PropagationPath[],
  ): PropagationPath[] {
    const seen = new Set<string>();
    const result: PropagationPath[] = [];
    for (const p of paths) {
      const key = this.pathKey(p);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(p);
      }
    }
    return result;
  }

  private pathKey(path: PropagationPath): string {
    if (path.hops.length === 0) {
      return `seed:${path.targetId}`;
    }
    return path.hops
      .map((h) => `${h.edgeKind}:${h.fromId}->${h.toId}`)
      .join('|');
  }

  private sortPaths(
    paths: readonly PropagationPath[],
  ): PropagationPath[] {
    return [...paths].sort((a, b) => {
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      const aKey = this.pathKey(a);
      const bKey = this.pathKey(b);
      return aKey.localeCompare(bKey);
    });
  }
}
