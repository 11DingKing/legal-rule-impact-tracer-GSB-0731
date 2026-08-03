import { ArticleStableId } from '../models/branded-types';
import { PathHop, PropagationPath } from '../models/propagation-path';
import { ReadOnlyRevisionGraph } from '../models/revision-graph';
import { getOrderedNeighbors } from './graph-neighbors';

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

    const neighbors = getOrderedNeighbors(graph, current);

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
