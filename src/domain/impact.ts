import {
  buildAdjacency,
  compareIds,
  dedupeAndSortPaths,
  enumerateSimplePaths,
  nodesFromEdges,
  pathKey,
  sortUnique,
} from './paths';
import type {
  ChangedArticle,
  Diagnostic,
  Effectiveness,
  ImpactPath,
  ImpactQuery,
  ImpactResult,
  LawVersion,
  MissingSuccession,
  PathEdge,
  RevisionGraph,
  RuleImpact,
  SuccessionEdge,
  VersionContextEntry,
} from './types';

/**
 * Thrown when a query names a law version that was never imported. Carries the
 * known version IDs so the HTTP layer can surface an actionable 404 without
 * reaching back into the graph.
 */
export class UnknownVersionError extends Error {
  public readonly code = 'UNKNOWN_VERSION';

  constructor(
    public readonly versionId: string,
    public readonly knownVersionIds: readonly string[],
  ) {
    super(`Unknown law version: ${versionId}`);
    this.name = 'UnknownVersionError';
  }
}

function requireVersion(graph: RevisionGraph, versionId: string): LawVersion {
  const version = graph.versions.find((candidate) => candidate.id === versionId);
  if (version === undefined) {
    throw new UnknownVersionError(
      versionId,
      graph.versions.map((candidate) => candidate.id).sort(compareIds),
    );
  }
  return version;
}

/** Sort succession edges so a changed article lists its targets stably. */
function sortSuccessionEdges(edges: readonly SuccessionEdge[]): SuccessionEdge[] {
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

/** Collapse the union of traversed edges into a sorted, deduplicated list. */
function dedupePathEdges(edges: readonly PathEdge[]): PathEdge[] {
  const seen = new Set<string>();
  const unique: PathEdge[] = [];
  for (const edge of sortPathEdges(edges)) {
    const key = `${edge.kind}\u0000${edge.fromId}\u0000${edge.toId}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(edge);
    }
  }
  return unique;
}

/**
 * Classify a version relative to the query instant. DRAFT and EFFECTIVE are
 * intrinsic; PUBLISHED depends on whether `asOf` has reached `effectiveFrom`.
 * This is what keeps same-day draft and published-not-yet-effective versions
 * distinct in query results.
 */
export function deriveEffectiveness(
  version: LawVersion,
  asOf: string,
): Effectiveness {
  if (version.status === 'DRAFT') {
    return 'DRAFT';
  }
  if (version.status === 'EFFECTIVE') {
    return 'EFFECTIVE';
  }
  const asOfDate = asOf.slice(0, 10);
  return version.effectiveFrom !== null && version.effectiveFrom <= asOfDate
    ? 'EFFECTIVE'
    : 'NOT_YET_EFFECTIVE';
}

function toContextEntry(version: LawVersion, asOf: string): VersionContextEntry {
  return {
    id: version.id,
    status: version.status,
    effectiveFrom: version.effectiveFrom,
    effectivenessAtAsOf: deriveEffectiveness(version, asOf),
  };
}

/**
 * Choose one witness path per affected rule: the shortest by edge count, and
 * among equal-length candidates the lexicographically smallest by node key.
 * Also reports how many equal-length shortest witnesses exist.
 */
function selectWitness(rulePaths: readonly ImpactPath[]): {
  witness: ImpactPath | null;
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
 * The single entry point of the pure domain module. It derives, from an
 * immutable graph and a fully specified query, the direct / indirect /
 * unaffected classification of every bound rule plus the deterministic
 * propagation paths and traversed edges. It performs no I/O and never mutates
 * its inputs, so persistence and HTTP layers can call it freely.
 */
export function computeImpact(
  graph: RevisionGraph,
  query: ImpactQuery,
): ImpactResult {
  const fromVersion = requireVersion(graph, query.fromVersion);
  const toVersion = requireVersion(graph, query.toVersion);

  const fromArticleIds = new Set(
    graph.articles
      .filter((article) => article.versionId === query.fromVersion)
      .map((article) => article.stableId),
  );
  const toArticleIds = new Set(
    graph.articles
      .filter((article) => article.versionId === query.toVersion)
      .map((article) => article.stableId),
  );

  // Succession edges that originate from an article present in the FROM
  // version. Identity across versions is followed only along these explicit
  // edges — never inferred from labels or text.
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
      changedArticles.push({ stableId, reason: 'SUCCESSION', succession: edges });
      changedIds.add(stableId);
    } else if (!toArticleIds.has(stableId)) {
      // No succession edge and no same-stable-ID counterpart in TO: the article
      // disappeared without an explicit trace. Report, do not guess.
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

  // Reverse cross-reference edges: if B cites A, then a change at A propagates
  // to B, so we walk from the cited article (A) to the citing one (B).
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
      kind: 'REFERENCE_REVERSE',
    });
  }
  const adjacency = buildAdjacency(reverseReferenceEdges);

  // Indirect reach: BFS over the reverse-reference graph from changed articles.
  // Visited-set membership guarantees termination even with reference cycles.
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

  const missingSuccession: MissingSuccession[] = missingIds.map((stableId) => ({
    stableId,
    boundRuleIds: [...bindingsByRule.entries()]
      .filter(([, articles]) => articles.has(stableId))
      .map(([ruleId]) => ruleId)
      .sort(compareIds),
  }));

  const direct: RuleImpact[] = [];
  const indirect: RuleImpact[] = [];
  const unaffected: RuleImpact[] = [];
  const paths: ImpactPath[] = [];

  for (const ruleId of [...bindingsByRule.keys()].sort(compareIds)) {
    const boundArticles = sortUnique(bindingsByRule.get(ruleId) ?? []);
    const directVia = boundArticles.filter((id) => changedIds.has(id));
    const indirectVia = boundArticles.filter((id) => indirectIds.has(id));

    if (directVia.length > 0) {
      const rulePaths: ImpactPath[] = directVia.map((articleId) => ({
        ruleId,
        impact: 'DIRECT',
        nodes: [articleId],
        edges: [],
      }));
      direct.push({
        ruleId,
        level: 'DIRECT',
        via: directVia,
        ...selectWitness(rulePaths),
      });
      paths.push(...rulePaths);
      continue;
    }

    if (indirectVia.length > 0) {
      const indirectViaSet = new Set(indirectVia);
      const rulePaths: ImpactPath[] = [];
      for (const chain of enumerateSimplePaths(
        adjacency,
        [...changedIds],
        indirectViaSet,
        'REFERENCE_REVERSE',
      )) {
        const first = chain[0];
        if (first === undefined) {
          continue;
        }
        const nodes = nodesFromEdges(first.fromId, chain);
        const lastNode = nodes[nodes.length - 1];
        if (lastNode === undefined || !indirectViaSet.has(lastNode)) {
          continue;
        }
        rulePaths.push({ ruleId, impact: 'INDIRECT', nodes, edges: chain });
      }
      const completePaths = dedupeAndSortPaths(rulePaths);
      indirect.push({
        ruleId,
        level: 'INDIRECT',
        via: indirectVia,
        ...selectWitness(completePaths),
      });
      paths.push(...completePaths);
      continue;
    }

    unaffected.push({
      ruleId,
      level: 'UNAFFECTED',
      via: [],
      witness: null,
      witnessCount: 0,
    });
  }

  const orderedPaths = [...paths].sort(
    (a, b) =>
      compareIds(a.ruleId, b.ruleId) || compareIds(pathKey(a.nodes), pathKey(b.nodes)),
  );

  const traversedEdges = dedupePathEdges([
    ...changedArticles.flatMap((changed) =>
      changed.succession.map(
        (edge): PathEdge => ({
          fromId: edge.fromId,
          toId: edge.toId,
          kind: 'SUCCESSION',
        }),
      ),
    ),
    ...orderedPaths.flatMap((path) => path.edges),
  ]);

  const diagnostics: Diagnostic[] = missingSuccession.map((entry) => ({
    code: 'MISSING_SUCCESSION',
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
      from: toContextEntry(fromVersion, query.asOf),
      to: toContextEntry(toVersion, query.asOf),
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
