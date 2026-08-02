import {
  buildAdjacency,
  compareIds,
  dedupeAndSortPaths,
  enumerateSimplePaths,
  nodesFromEdges,
  pathKey,
  sortUnique,
} from "./paths";
import type {
  ChangedArticle,
  Diagnostic,
  ImpactQuery,
  ImpactResult,
  LawVersion,
  PathEdge,
  PropagationPath,
  RevisionGraph,
  RuleImpact,
  SuccessionEdge,
} from "./types";

export class UnknownVersionError extends Error {
  readonly code = "UNKNOWN_VERSION";

  constructor(
    readonly versionId: string,
    readonly knownVersionIds: readonly string[],
  ) {
    super(`Unknown law version: ${versionId}`);
    this.name = "UnknownVersionError";
  }
}

function requireVersion(graph: RevisionGraph, versionId: string): LawVersion {
  const version = graph.versions.find(
    (candidate) => candidate.id === versionId,
  );
  if (version === undefined) {
    throw new UnknownVersionError(
      versionId,
      graph.versions.map((candidate) => candidate.id).sort(compareIds),
    );
  }
  return version;
}

function sortSuccessionEdges(
  edges: readonly SuccessionEdge[],
): SuccessionEdge[] {
  return [...edges].sort(
    (a, b) =>
      compareIds(a.fromId, b.fromId) ||
      compareIds(a.toId, b.toId) ||
      compareIds(a.kind, b.kind),
  );
}

function sortPathEdges(edges: readonly PathEdge[]): PathEdge[] {
  return [...edges].sort(
    (a, b) =>
      compareIds(a.kind, b.kind) ||
      compareIds(a.fromId, b.fromId) ||
      compareIds(a.toId, b.toId),
  );
}

function dedupePathEdges(edges: readonly PathEdge[]): PathEdge[] {
  const seen = new Set<string>();
  const unique: PathEdge[] = [];
  for (const edge of sortPathEdges(edges)) {
    const key = `${edge.kind}${edge.fromId}${edge.toId}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(edge);
    }
  }
  return unique;
}

/**
 * Pick the shortest propagation witness for one rule from its complete,
 * deduplicated path set: minimum edge count wins, ties are broken by the
 * lexicographically smallest node sequence. `witnessCount` reports how many
 * distinct witnesses share that minimal length.
 */
function selectWitness(rulePaths: readonly PropagationPath[]): {
  witness: PropagationPath | null;
  witnessCount: number;
} {
  let minLength = Number.POSITIVE_INFINITY;
  for (const path of rulePaths) {
    minLength = Math.min(minLength, path.edges.length);
  }
  if (!Number.isFinite(minLength)) {
    return { witness: null, witnessCount: 0 };
  }
  const shortest = rulePaths
    .filter((path) => path.edges.length === minLength)
    .sort((a, b) => compareIds(pathKey(a.nodes), pathKey(b.nodes)));
  const witness = shortest[0];
  return witness === undefined
    ? { witness: null, witnessCount: 0 }
    : { witness, witnessCount: shortest.length };
}

/**
 * Evaluate one revision query against a graph slice.
 *
 * Pure and total with respect to its inputs: no I/O, no clock, no randomness.
 * Identical (graph, query) pairs always yield identical results; every
 * collection in the output is deterministically sorted.
 *
 * Rules of the evaluation:
 * - An article of the from-version is CHANGED iff it has explicit outgoing
 *   succession edges (RENUMBER / SPLIT / MERGE).
 * - An article of the from-version with neither succession edges nor a
 *   same-stable-ID counterpart in the to-version is reported in
 *   `missingSuccession` (together with its bound rules). It is never
 *   silently treated as unchanged, never re-linked by label or text
 *   similarity, and it is not a change source by itself — but it still
 *   participates in the cross-reference graph, so it can receive indirect
 *   impact from genuinely changed articles.
 * - Impact propagates from a changed article A to every article that cites A
 *   directly or transitively (reverse cross-reference direction), because a
 *   citing article depends on the cited one. Cycles are traversed safely.
 * - A bound rule is DIRECT when bound to a changed article, INDIRECT when
 *   bound only to articles reached through reverse references, UNAFFECTED
 *   otherwise.
 */
export function computeImpact(
  graph: RevisionGraph,
  query: ImpactQuery,
): ImpactResult {
  const fromVersion = requireVersion(graph, query.fromVersion);
  const toVersion = requireVersion(graph, query.toVersion);

  const fromArticleIds = new Set(
    graph.articles
      .filter((a) => a.versionId === query.fromVersion)
      .map((a) => a.stableId),
  );
  const toArticleIds = new Set(
    graph.articles
      .filter((a) => a.versionId === query.toVersion)
      .map((a) => a.stableId),
  );

  const successionByFrom = new Map<string, SuccessionEdge[]>();
  for (const edge of graph.succession) {
    if (!fromArticleIds.has(edge.fromId)) {
      continue;
    }
    const bucket = successionByFrom.get(edge.fromId) ?? [];
    bucket.push(edge);
    successionByFrom.set(edge.fromId, bucket);
  }

  const changedArticles: ChangedArticle[] = [];
  const missingIds: string[] = [];
  const unchangedArticles: string[] = [];
  const changedIds = new Set<string>();

  for (const stableId of sortUnique(fromArticleIds)) {
    const edges = sortSuccessionEdges(successionByFrom.get(stableId) ?? []);
    if (edges.length > 0) {
      changedArticles.push({
        stableId,
        reason: "SUCCESSION",
        succession: edges,
      });
      changedIds.add(stableId);
    } else if (!toArticleIds.has(stableId)) {
      missingIds.push(stableId);
    } else {
      unchangedArticles.push(stableId);
    }
  }

  const hasIncomingSuccession = new Set(
    graph.succession
      .filter((edge) => fromArticleIds.has(edge.fromId))
      .map((edge) => edge.toId),
  );
  const addedArticles = sortUnique(
    [...toArticleIds].filter(
      (id) => !fromArticleIds.has(id) && !hasIncomingSuccession.has(id),
    ),
  );

  // Reverse reference adjacency within the from-version: if B cites A, then
  // a change to A propagates to B. References to articles outside the
  // from-version cannot propagate rule impact and are ignored.
  const reverseReferenceEdges: PathEdge[] = [];
  for (const ref of graph.references) {
    if (ref.versionId !== query.fromVersion) {
      continue;
    }
    if (!fromArticleIds.has(ref.fromId) || !fromArticleIds.has(ref.toId)) {
      continue;
    }
    reverseReferenceEdges.push({
      fromId: ref.toId,
      toId: ref.fromId,
      kind: "REFERENCE_REVERSE",
    });
  }
  const adjacency = buildAdjacency(reverseReferenceEdges);

  // Closure of indirectly affected articles (changed set excluded).
  const indirectIds = new Set<string>();
  const queue = [...changedIds].sort(compareIds);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    for (const next of adjacency.get(current) ?? []) {
      if (!changedIds.has(next) && !indirectIds.has(next)) {
        indirectIds.add(next);
        queue.push(next);
      }
    }
  }

  const bindingsByRule = new Map<string, Set<string>>();
  for (const binding of graph.bindings) {
    const bucket = bindingsByRule.get(binding.ruleId) ?? new Set<string>();
    bucket.add(binding.articleId);
    bindingsByRule.set(binding.ruleId, bucket);
  }

  const missingSuccession: ImpactResult["missingSuccession"] = missingIds.map(
    (stableId) => ({
      stableId,
      boundRuleIds: [...bindingsByRule.entries()]
        .filter(([, articles]) => articles.has(stableId))
        .map(([ruleId]) => ruleId)
        .sort(compareIds),
    }),
  );

  const direct: RuleImpact[] = [];
  const indirect: RuleImpact[] = [];
  const unaffected: RuleImpact[] = [];
  const paths: PropagationPath[] = [];

  for (const ruleId of [...bindingsByRule.keys()].sort(compareIds)) {
    const boundArticles = sortUnique(bindingsByRule.get(ruleId) ?? []);
    const directVia = boundArticles.filter((id) => changedIds.has(id));
    const indirectVia = boundArticles.filter((id) => indirectIds.has(id));

    if (directVia.length > 0) {
      const rulePaths = directVia.map(
        (articleId): PropagationPath => ({
          ruleId,
          impact: "DIRECT",
          nodes: [articleId],
          edges: [],
        }),
      );
      direct.push({
        ruleId,
        level: "DIRECT",
        via: directVia,
        ...selectWitness(rulePaths),
      });
      paths.push(...rulePaths);
      continue;
    }

    if (indirectVia.length > 0) {
      const rulePaths: PropagationPath[] = [];
      for (const chain of enumerateSimplePaths(
        adjacency,
        [...changedIds],
        new Set(indirectVia),
        "REFERENCE_REVERSE",
      )) {
        if (chain.length === 0) {
          continue;
        }
        const first = chain[0];
        if (first === undefined) {
          continue;
        }
        const nodes = nodesFromEdges(first.fromId, chain);
        const lastNode = nodes[nodes.length - 1];
        if (lastNode === undefined || !indirectVia.includes(lastNode)) {
          continue;
        }
        rulePaths.push({ ruleId, impact: "INDIRECT", nodes, edges: chain });
      }
      const completePaths = dedupeAndSortPaths(rulePaths);
      indirect.push({
        ruleId,
        level: "INDIRECT",
        via: indirectVia,
        ...selectWitness(completePaths),
      });
      paths.push(...completePaths);
      continue;
    }

    unaffected.push({
      ruleId,
      level: "UNAFFECTED",
      via: [],
      witness: null,
      witnessCount: 0,
    });
  }

  const orderedPaths = [...paths].sort(
    (a, b) =>
      compareIds(a.ruleId, b.ruleId) ||
      compareIds(a.nodes.join(""), b.nodes.join("")),
  );

  const traversedEdges = dedupePathEdges([
    ...changedArticles.flatMap((changed) =>
      changed.succession.map(
        (edge): PathEdge => ({
          fromId: edge.fromId,
          toId: edge.toId,
          kind: "SUCCESSION",
        }),
      ),
    ),
    ...orderedPaths.flatMap((path) => path.edges),
  ]);

  const diagnostics: Diagnostic[] = missingSuccession.map((entry) => ({
    code: "MISSING_SUCCESSION",
    stableId: entry.stableId,
    boundRuleIds: entry.boundRuleIds,
    message:
      `Article ${entry.stableId} has no succession edge into version ` +
      `${query.toVersion} and no same-stable-ID counterpart there; ` +
      `identity is not inferred from labels or text.`,
  }));

  return {
    query,
    versionContext: {
      from: {
        id: fromVersion.id,
        status: fromVersion.status,
        effectiveFrom: fromVersion.effectiveFrom,
      },
      to: {
        id: toVersion.id,
        status: toVersion.status,
        effectiveFrom: toVersion.effectiveFrom,
      },
    },
    changedArticles,
    missingSuccession,
    unchangedArticles,
    addedArticles,
    rules: { direct, indirect, unaffected },
    diagnostics,
    paths: orderedPaths,
    traversedEdges,
  };
}
