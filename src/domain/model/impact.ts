import type {
  ArticleImpact,
  ArticleKey,
  DanglingReference,
  EdgeKind,
  ImpactQuery,
  ImpactResult,
  MissingSuccession,
  PropagationPath,
  RuleImpact,
} from './types';
import type { BuiltGraph } from './graph';
import { parseArticleKey } from './article-key';

const DEFAULT_MAX_PATH_LENGTH = 24;
const DEFAULT_MAX_PATHS_PER_TARGET = 16;
const HARD_PATH_BUDGET = 200_000;

interface TraversalEdge {
  readonly from: ArticleKey;
  readonly to: ArticleKey;
  readonly kind: EdgeKind;
  readonly detail: string;
}

export interface ComputeOptions {
  readonly maxPathLength?: number;
  readonly maxPathsPerTarget?: number;
}

export function computeImpact(
  graph: BuiltGraph,
  query: ImpactQuery,
  options: ComputeOptions = {},
): ImpactResult {
  const maxPathLength = options.maxPathLength
    ?? query.maxPathLength
    ?? DEFAULT_MAX_PATH_LENGTH;
  const maxPathsPerTarget = options.maxPathsPerTarget
    ?? query.maxPathsPerTarget
    ?? DEFAULT_MAX_PATHS_PER_TARGET;

  const seedKeys = collectSeedKeys(graph, query);
  const directKeys = new Set<ArticleKey>(seedKeys);

  const traversal = buildTraversalAdjacency(graph);
  const reachable = findReachable(graph, seedKeys, traversal, maxPathLength);

  const indirectKeys = new Set<ArticleKey>();
  for (const k of reachable) {
    if (!directKeys.has(k)) indirectKeys.add(k);
  }

  const allKeys = new Set<ArticleKey>(graph.articlesByKey.keys());
  const unaffectedKeys = new Set<ArticleKey>();
  for (const k of allKeys) {
    if (!directKeys.has(k) && !indirectKeys.has(k)) unaffectedKeys.add(k);
  }

  const pathMap = enumerateShortestPaths(
    seedKeys,
    reachable,
    directKeys,
    traversal,
    maxPathLength,
    maxPathsPerTarget,
  );

  const articleImpacts = buildArticleImpacts(
    graph,
    directKeys,
    indirectKeys,
    pathMap,
  );

  const ruleImpacts = buildRuleImpacts(graph, directKeys, indirectKeys, pathMap);

  const missing = detectMissingSuccession(graph, query);

  const dangling: ReadonlyArray<DanglingReference> = graph.danglingReferences;

  return {
    query,
    articles: articleImpacts,
    rules: ruleImpacts,
    directKeys: Object.freeze([...directKeys].sort()),
    indirectKeys: Object.freeze([...indirectKeys].sort()),
    unaffectedKeys: Object.freeze([...unaffectedKeys].sort()),
    missingSuccession: missing,
    danglingReferences: dangling,
    truncated: pathMap.truncated,
  };
}

function collectSeedKeys(
  graph: BuiltGraph,
  query: ImpactQuery,
): ReadonlyArray<ArticleKey> {
  const seeds = new Set<ArticleKey>();
  for (const e of graph.edges) {
    if (e.kind !== 'SUCCESSION') continue;
    const fromVer = parseArticleKey(e.from).versionId;
    const toVer = parseArticleKey(e.to).versionId;
    if (fromVer === query.fromVersionId && toVer === query.toVersionId) {
      seeds.add(e.from);
      seeds.add(e.to);
    }
  }
  return [...seeds].sort();
}

function buildTraversalAdjacency(
  graph: BuiltGraph,
): ReadonlyMap<ArticleKey, ReadonlyArray<TraversalEdge>> {
  const adj = new Map<ArticleKey, TraversalEdge[]>();
  const add = (e: TraversalEdge): void => {
    const list = adj.get(e.from);
    if (list) list.push(e);
    else adj.set(e.from, [e]);
  };

  for (const e of graph.edges) {
    if (e.kind === 'SUCCESSION') {
      add({
        from: e.from,
        to: e.to,
        kind: 'SUCCESSION',
        detail: e.successionKind ?? 'REPLACE',
      });
    } else if (e.kind === 'REFERENCE') {
      add({
        from: e.to,
        to: e.from,
        kind: 'REFERENCE',
        detail: e.refStableId ?? '',
      });
    }
  }

  for (const list of adj.values()) {
    list.sort((a, b) => {
      if (a.to !== b.to) return a.to < b.to ? -1 : 1;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      return a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0;
    });
  }
  return adj;
}

function findReachable(
  graph: BuiltGraph,
  seeds: ReadonlyArray<ArticleKey>,
  adj: ReadonlyMap<ArticleKey, ReadonlyArray<TraversalEdge>>,
  maxLen: number,
): Set<ArticleKey> {
  const reachable = new Set<ArticleKey>(seeds);
  const dist = new Map<ArticleKey, number>();
  for (const s of seeds) dist.set(s, 0);
  const queue: ArticleKey[] = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift() as ArticleKey;
    const d = dist.get(current) ?? 0;
    if (d >= maxLen) continue;
    const edges = adj.get(current);
    if (!edges) continue;
    for (const e of edges) {
      if (reachable.has(e.to)) continue;
      if (!graph.articlesByKey.has(e.to)) continue;
      reachable.add(e.to);
      dist.set(e.to, d + 1);
      queue.push(e.to);
    }
  }
  return reachable;
}

interface PathEnumerationResult {
  readonly paths: ReadonlyMap<ArticleKey, ReadonlyArray<PropagationPath>>;
  readonly truncated: boolean;
}

function enumerateShortestPaths(
  seeds: ReadonlyArray<ArticleKey>,
  reachable: ReadonlySet<ArticleKey>,
  direct: ReadonlySet<ArticleKey>,
  adj: ReadonlyMap<ArticleKey, ReadonlyArray<TraversalEdge>>,
  maxLen: number,
  maxPathsPerTarget: number,
): PathEnumerationResult {
  const result = new Map<ArticleKey, PropagationPath[]>();
  let truncated = false;
  let totalBudget = HARD_PATH_BUDGET;

  for (const seed of seeds) {
    const seedPath: PropagationPath = {
      nodes: Object.freeze([seed]),
      edges: Object.freeze([]),
      length: 0,
    };
    pushPath(result, seed, seedPath);
  }

  const distances = computeShortestDistances(seeds, adj, maxLen);

  for (const target of reachable) {
    if (direct.has(target)) continue;
    const targetDist = distances.get(target);
    if (targetDist === undefined) continue;

    const paths: PropagationPath[] = [];
    const stack: { node: ArticleKey; pathNodes: ArticleKey[]; pathEdges: EdgeKind[]; depth: number }[] = [];
    for (const seed of seeds) {
      if (distances.get(seed) === 0) {
        stack.push({ node: seed, pathNodes: [seed], pathEdges: [], depth: 0 });
      }
    }

    while (stack.length > 0) {
      if (totalBudget <= 0) {
        truncated = true;
        break;
      }
      totalBudget--;

      const frame = stack.pop() as {
        node: ArticleKey;
        pathNodes: ArticleKey[];
        pathEdges: EdgeKind[];
        depth: number;
      };

      if (frame.node === target) {
        paths.push({
          nodes: Object.freeze([...frame.pathNodes]),
          edges: Object.freeze([...frame.pathEdges]),
          length: frame.depth,
        });
        if (paths.length >= maxPathsPerTarget) break;
        continue;
      }

      if (frame.depth >= targetDist) continue;

      const edges = adj.get(frame.node);
      if (!edges) continue;

      for (let i = edges.length - 1; i >= 0; i--) {
        const e = edges[i];
        if (frame.pathNodes.includes(e.to)) continue;
        const nextDist = distances.get(e.to);
        if (nextDist === undefined) continue;
        if (nextDist !== frame.depth + 1) continue;
        if (frame.depth + 1 > targetDist) continue;
        stack.push({
          node: e.to,
          pathNodes: [...frame.pathNodes, e.to],
          pathEdges: [...frame.pathEdges, e.kind],
          depth: frame.depth + 1,
        });
      }
    }

    const canonical = dedupAndSortPaths(paths).slice(0, maxPathsPerTarget);
    if (paths.length > canonical.length) truncated = true;
    result.set(target, canonical);
  }

  return {
    paths: result,
    truncated,
  };
}

function computeShortestDistances(
  seeds: ReadonlyArray<ArticleKey>,
  adj: ReadonlyMap<ArticleKey, ReadonlyArray<TraversalEdge>>,
  maxLen: number,
): ReadonlyMap<ArticleKey, number> {
  const dist = new Map<ArticleKey, number>();
  for (const s of seeds) dist.set(s, 0);
  const queue: ArticleKey[] = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift() as ArticleKey;
    const d = dist.get(current) ?? 0;
    if (d >= maxLen) continue;
    const edges = adj.get(current);
    if (!edges) continue;
    for (const e of edges) {
      if (dist.has(e.to)) continue;
      dist.set(e.to, d + 1);
      queue.push(e.to);
    }
  }
  return dist;
}

function dedupAndSortPaths(paths: PropagationPath[]): PropagationPath[] {
  const seen = new Set<string>();
  const out: PropagationPath[] = [];
  for (const p of paths) {
    const key = p.nodes.join('>');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  out.sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    for (let i = 0; i < a.nodes.length; i++) {
      const na = a.nodes[i] ?? '';
      const nb = b.nodes[i] ?? '';
      if (na !== nb) return na < nb ? -1 : 1;
    }
    for (let i = 0; i < a.edges.length; i++) {
      const ea = a.edges[i] ?? '';
      const eb = b.edges[i] ?? '';
      if (ea !== eb) return ea < eb ? -1 : 1;
    }
    return 0;
  });
  return out;
}

function pushPath(
  map: Map<ArticleKey, PropagationPath[]>,
  key: ArticleKey,
  path: PropagationPath,
): void {
  const list = map.get(key);
  if (list) list.push(path);
  else map.set(key, [path]);
}

function buildArticleImpacts(
  graph: BuiltGraph,
  direct: ReadonlySet<ArticleKey>,
  indirect: ReadonlySet<ArticleKey>,
  pathMap: PathEnumerationResult,
): ReadonlyArray<ArticleImpact> {
  const out: ArticleImpact[] = [];
  for (const article of graph.articlesByKey.values()) {
    let level: 'DIRECT' | 'INDIRECT' | 'UNAFFECTED';
    if (direct.has(article.key)) level = 'DIRECT';
    else if (indirect.has(article.key)) level = 'INDIRECT';
    else level = 'UNAFFECTED';

    const paths = level === 'UNAFFECTED'
      ? Object.freeze([])
      : Object.freeze(pathMap.paths.get(article.key) ?? []);

    out.push({
      key: article.key,
      stableId: article.stableId,
      versionId: article.versionId,
      label: article.label,
      level,
      paths,
    });
  }
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return Object.freeze(out);
}

function buildRuleImpacts(
  graph: BuiltGraph,
  direct: ReadonlySet<ArticleKey>,
  indirect: ReadonlySet<ArticleKey>,
  pathMap: PathEnumerationResult,
): ReadonlyArray<RuleImpact> {
  const out: RuleImpact[] = [];
  for (const rule of graph.rules.values()) {
    let level: 'DIRECT' | 'INDIRECT' | 'UNAFFECTED' = 'UNAFFECTED';
    const directArticles: ArticleKey[] = [];
    const indirectArticles: ArticleKey[] = [];
    for (const k of rule.boundKeys) {
      if (direct.has(k)) {
        if (level !== 'INDIRECT') level = 'DIRECT';
        directArticles.push(k);
      } else if (indirect.has(k)) {
        if (level === 'UNAFFECTED') level = 'INDIRECT';
        indirectArticles.push(k);
      }
    }
    const affected = [...directArticles, ...indirectArticles].sort();
    const paths: PropagationPath[] = [];
    for (const k of affected) {
      const p = pathMap.paths.get(k);
      if (p) paths.push(...p);
    }
    out.push({
      ruleId: rule.ruleId,
      level,
      articleKeys: Object.freeze(affected),
      paths: Object.freeze(dedupAndSortPaths(paths)),
    });
  }
  out.sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0));
  return Object.freeze(out);
}

function detectMissingSuccession(
  graph: BuiltGraph,
  query: ImpactQuery,
): ReadonlyArray<MissingSuccession> {
  const out: MissingSuccession[] = [];
  const toVersion = graph.versions.get(query.toVersionId);
  const fromVersion = graph.versions.get(query.fromVersionId);
  if (!toVersion || !fromVersion) return Object.freeze(out);

  const fromOrdinal = fromVersion.ordinal;
  const toOrdinal = toVersion.ordinal;
  if (toOrdinal <= fromOrdinal) return Object.freeze(out);

  const coveredFromStable = new Set<string>();
  const coveredToStable = new Set<string>();
  for (const e of graph.edges) {
    if (e.kind !== 'SUCCESSION') continue;
    const fv = parseArticleKey(e.from).versionId;
    const tv = parseArticleKey(e.to).versionId;
    if (fv !== query.fromVersionId || tv !== query.toVersionId) continue;
    coveredFromStable.add(parseArticleKey(e.from).stableId);
    coveredToStable.add(parseArticleKey(e.to).stableId);
  }

  for (const [stableId, list] of graph.articlesByStable.entries()) {
    const inFrom = list.some((a: { versionId: string }) => a.versionId === query.fromVersionId);
    const inTo = list.some((a: { versionId: string }) => a.versionId === query.toVersionId);
    if (inFrom && !inTo && !coveredFromStable.has(stableId)) {
      out.push({
        stableId,
        fromVersionId: query.fromVersionId,
        toVersionId: query.toVersionId,
        reason: 'ARTICLE_IN_FROM_VERSION_BUT_NO_SUCCESSION_TO_TARGET_VERSION',
      });
    }
    if (!inFrom && inTo && !coveredToStable.has(stableId)) {
      out.push({
        stableId,
        fromVersionId: query.fromVersionId,
        toVersionId: query.toVersionId,
        reason: 'ARTICLE_IN_TO_VERSION_BUT_NO_SUCCESSION_FROM_SOURCE_VERSION',
      });
    }
  }

  out.sort((a, b) => {
    if (a.stableId !== b.stableId) {
      return a.stableId < b.stableId ? -1 : 1;
    }
    return a.reason < b.reason ? -1 : 1;
  });
  return Object.freeze(out);
}
