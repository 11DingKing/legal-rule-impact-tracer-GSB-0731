import type { PathEdge, PathEdgeKind } from './types';

/**
 * Deterministic graph helpers used by the impact evaluator. Every routine here
 * is pure and total: given the same inputs it produces byte-identical outputs,
 * regardless of the order in which edges or nodes were supplied.
 */

/** Total ordering over string IDs (code-unit comparison, locale-independent). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deduplicate and sort a collection of IDs into a stable array. */
export function sortUnique(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort(compareIds);
}

/**
 * Build a sorted adjacency map from directed edges. Neighbour lists are sorted
 * so traversal order is fixed no matter how the edges arrived.
 */
export function buildAdjacency(
  edges: readonly PathEdge[],
): Map<string, string[]> {
  const buckets = new Map<string, Set<string>>();
  for (const edge of edges) {
    let bucket = buckets.get(edge.fromId);
    if (bucket === undefined) {
      bucket = new Set<string>();
      buckets.set(edge.fromId, bucket);
    }
    bucket.add(edge.toId);
  }
  const sorted = new Map<string, string[]>();
  for (const [fromId, targets] of buckets) {
    sorted.set(fromId, [...targets].sort(compareIds));
  }
  return sorted;
}

/** Stable key for a node sequence; used for dedup and sorting of paths. */
export function pathKey(nodes: readonly string[]): string {
  return nodes.join('\u0000');
}

/** Reconstruct the node sequence implied by a start node and its edges. */
export function nodesFromEdges(start: string, edges: readonly PathEdge[]): string[] {
  const nodes = [start];
  for (const edge of edges) {
    nodes.push(edge.toId);
  }
  return nodes;
}

/**
 * Enumerate every simple path (no repeated node) from each start node to any
 * target node. Cycles terminate because a node already on the current path is
 * never revisited. Starts are processed in sorted order and neighbours are
 * pre-sorted, so the emitted list is deterministic.
 */
export function enumerateSimplePaths(
  adjacency: Map<string, string[]>,
  starts: readonly string[],
  targets: ReadonlySet<string>,
  edgeKind: PathEdgeKind,
): PathEdge[][] {
  const results: PathEdge[][] = [];
  for (const start of sortUnique(starts)) {
    const onPath = new Set<string>([start]);
    const edges: PathEdge[] = [];
    const walk = (node: string): void => {
      if (edges.length > 0 && targets.has(node)) {
        results.push([...edges]);
      }
      for (const next of adjacency.get(node) ?? []) {
        if (onPath.has(next)) {
          continue;
        }
        onPath.add(next);
        edges.push({ fromId: node, toId: next, kind: edgeKind });
        walk(next);
        edges.pop();
        onPath.delete(next);
      }
    };
    walk(start);
  }
  return results;
}

interface NodeCarrier {
  readonly nodes: readonly string[];
}

/** Deduplicate paths by node sequence and sort them by that sequence. */
export function dedupeAndSortPaths<T extends NodeCarrier>(paths: readonly T[]): T[] {
  const seen = new Map<string, T>();
  for (const path of paths) {
    const key = pathKey(path.nodes);
    if (!seen.has(key)) {
      seen.set(key, path);
    }
  }
  return [...seen.values()].sort((a, b) =>
    compareIds(pathKey(a.nodes), pathKey(b.nodes)),
  );
}
