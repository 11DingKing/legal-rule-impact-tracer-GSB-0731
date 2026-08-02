import type { PathEdge, PathEdgeKind } from "./types";

/**
 * Deterministic adjacency: neighbour IDs sorted ascending, duplicates removed.
 * Stable ordering of traversal is what makes downstream path order stable.
 */
export function buildAdjacency(
  edges: readonly PathEdge[],
): ReadonlyMap<string, readonly string[]> {
  const buckets = new Map<string, Set<string>>();
  for (const edge of edges) {
    let bucket = buckets.get(edge.fromId);
    if (bucket === undefined) {
      bucket = new Set<string>();
      buckets.set(edge.fromId, bucket);
    }
    bucket.add(edge.toId);
  }
  const sorted = new Map<string, readonly string[]>();
  for (const [fromId, targets] of buckets) {
    sorted.set(fromId, [...targets].sort(compareIds));
  }
  return sorted;
}

export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortUnique(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort(compareIds);
}

/**
 * Enumerate every simple path (no repeated nodes) from any `start` node to
 * any node in `targets`. Cycle-safe by construction: a node already on the
 * current path is never revisited, so reference cycles terminate.
 *
 * Neighbours are visited in ascending ID order; the caller additionally
 * deduplicates and sorts the final path list, so output order does not
 * depend on Map/Set iteration order.
 */
export function enumerateSimplePaths(
  adjacency: ReadonlyMap<string, readonly string[]>,
  starts: readonly string[],
  targets: ReadonlySet<string>,
  edgeKind: PathEdgeKind,
): PathEdge[][] {
  const results: PathEdge[][] = [];
  const sortedStarts = sortUnique(starts);
  for (const start of sortedStarts) {
    const onPath = new Set<string>([start]);
    const walk = (node: string, edges: PathEdge[]): void => {
      if (edges.length > 0 && targets.has(node)) {
        results.push([...edges]);
        // Do not return: a target may also be an intermediate node on a
        // longer path to another target.
      }
      const neighbours = adjacency.get(node) ?? [];
      for (const next of neighbours) {
        if (onPath.has(next)) {
          continue;
        }
        onPath.add(next);
        edges.push({ fromId: node, toId: next, kind: edgeKind });
        walk(next, edges);
        edges.pop();
        onPath.delete(next);
      }
    };
    walk(start, []);
  }
  return results;
}

/** Canonical serialization used for path deduplication and stable sorting. */
export function pathKey(nodes: readonly string[]): string {
  return nodes.join("");
}

/**
 * Deduplicate paths by their node sequence and sort lexicographically by
 * that sequence, so identical graphs always yield identical ordering.
 */
export function dedupeAndSortPaths<
  T extends { readonly nodes: readonly string[] },
>(paths: readonly T[]): T[] {
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

/** Derive the node sequence from a traversed edge chain. */
export function nodesFromEdges(
  start: string,
  edges: readonly PathEdge[],
): string[] {
  const nodes = [start];
  for (const edge of edges) {
    nodes.push(edge.toId);
  }
  return nodes;
}
