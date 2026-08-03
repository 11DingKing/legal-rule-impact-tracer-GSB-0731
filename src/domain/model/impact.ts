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
const MAX_EQUAL_LENGTH_COUNT = 1_000_000;

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

interface ShortestPathIndex {
  readonly distance: ReadonlyMap<ArticleKey, number>;
  readonly count: ReadonlyMap<ArticleKey, number>;
  readonly dag: ReadonlyMap<ArticleKey, ReadonlyArray<TraversalEdge>>;
  readonly predecessors: ReadonlyMap<ArticleKey, ReadonlyArray<TraversalEdge>>;
  readonly reachable: ReadonlySet<ArticleKey>;
  readonly seeds: ReadonlyArray<ArticleKey>;
  readonly truncated: boolean;
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
  const index = buildShortestPathIndex(
    graph,
    seedKeys,
    traversal,
    maxPathLength,
  );

  const indirectKeys = new Set<ArticleKey>();
  for (const k of index.reachable) {
    if (!directKeys.has(k)) indirectKeys.add(k);
  }

  const allKeys = new Set<ArticleKey>(graph.articlesByKey.keys());
  const unaffectedKeys = new Set<ArticleKey>();
  for (const k of allKeys) {
    if (!directKeys.has(k) && !indirectKeys.has(k)) unaffectedKeys.add(k);
  }

  const pathMap = enumerateShortestPaths(
    index,
    directKeys,
    maxPathsPerTarget,
  );

  const articleImpacts = buildArticleImpacts(
    graph,
    directKeys,
    indirectKeys,
    pathMap,
    index,
  );

  const ruleImpacts = buildRuleImpacts(
    graph,
    directKeys,
    indirectKeys,
    pathMap,
    index,
  );

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
    truncated: pathMap.truncated || index.truncated,
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
    list.sort(compareTraversalEdges);
  }
  return adj;
}

function compareTraversalEdges(a: TraversalEdge, b: TraversalEdge): number {
  if (a.to !== b.to) return a.to < b.to ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.detail !== b.detail) return a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0;
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  return 0;
}

function buildShortestPathIndex(
  graph: BuiltGraph,
  seeds: ReadonlyArray<ArticleKey>,
  adj: ReadonlyMap<ArticleKey, ReadonlyArray<TraversalEdge>>,
  maxLen: number,
): ShortestPathIndex {
  const distance = new Map<ArticleKey, number>();
  for (const s of seeds) distance.set(s, 0);

  const dag = new Map<ArticleKey, TraversalEdge[]>();
  const predecessors = new Map<ArticleKey, TraversalEdge[]>();
  let truncated = false;

  const queue: ArticleKey[] = [...seeds];
  const reachable = new Set<ArticleKey>(seeds);

  while (queue.length > 0) {
    const current = queue.shift() as ArticleKey;
    const d = distance.get(current) ?? 0;
    if (d >= maxLen) continue;
    const edges = adj.get(current);
    if (!edges) continue;

    for (const e of edges) {
      if (!graph.articlesByKey.has(e.to)) continue;
      const existing = distance.get(e.to);
      if (existing === undefined) {
        distance.set(e.to, d + 1);
        reachable.add(e.to);
        addDagEdge(dag, current, e);
        addPredecessor(predecessors, e.to, e);
        queue.push(e.to);
      } else if (existing === d + 1) {
        addDagEdge(dag, current, e);
        addPredecessor(predecessors, e.to, e);
      }
    }
  }

  const count = new Map<ArticleKey, number>();
  for (const s of seeds) count.set(s, 1);

  const orderedByDistance: ArticleKey[] = [...reachable].sort((a, b) => {
    const da = distance.get(a) ?? 0;
    const db = distance.get(b) ?? 0;
    if (da !== db) return da - db;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  for (const node of orderedByDistance) {
    if (distance.get(node) === 0) continue;
    const preds = predecessors.get(node) ?? [];
    let total = 0;
    for (const p of preds) {
      const c = count.get(p.from) ?? 0;
      total += c;
      if (total > MAX_EQUAL_LENGTH_COUNT) {
        total = MAX_EQUAL_LENGTH_COUNT;
        truncated = true;
        break;
      }
    }
    count.set(node, total);
  }

  return {
    distance,
    count,
    dag,
    predecessors,
    reachable,
    seeds,
    truncated,
  };
}

function addDagEdge(
  dag: Map<ArticleKey, TraversalEdge[]>,
  from: ArticleKey,
  edge: TraversalEdge,
): void {
  const list = dag.get(from);
  if (list) list.push(edge);
  else dag.set(from, [edge]);
}

function addPredecessor(
  predecessors: Map<ArticleKey, TraversalEdge[]>,
  to: ArticleKey,
  edge: TraversalEdge,
): void {
  const list = predecessors.get(to);
  if (list) list.push(edge);
  else predecessors.set(to, [edge]);
}

interface PathEnumerationResult {
  readonly paths: ReadonlyMap<ArticleKey, ReadonlyArray<PropagationPath>>;
  readonly truncated: boolean;
}

function enumerateShortestPaths(
  index: ShortestPathIndex,
  direct: ReadonlySet<ArticleKey>,
  maxPathsPerTarget: number,
): PathEnumerationResult {
  const result = new Map<ArticleKey, PropagationPath[]>();
  let truncated = false;
  let totalBudget = HARD_PATH_BUDGET;

  for (const seed of index.seeds) {
    const seedPath: PropagationPath = freezePath([seed], []);
    pushPath(result, seed, seedPath);
  }

  const targets: ArticleKey[] = [];
  for (const k of index.reachable) {
    if (!direct.has(k)) targets.push(k);
  }
  targets.sort();

  for (const target of targets) {
    const targetDist = index.distance.get(target);
    if (targetDist === undefined) continue;

    const paths: PropagationPath[] = [];
    const stack: {
      node: ArticleKey;
      pathNodes: ArticleKey[];
      pathEdges: EdgeKind[];
      depth: number;
    }[] = [];

    for (const seed of index.seeds) {
      stack.push({ node: seed, pathNodes: [seed], pathEdges: [], depth: 0 });
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
        paths.push(freezePath(frame.pathNodes, frame.pathEdges));
        if (paths.length >= maxPathsPerTarget) break;
        continue;
      }

      if (frame.depth >= targetDist) continue;

      const dagEdges = index.dag.get(frame.node);
      if (!dagEdges) continue;

      for (let i = dagEdges.length - 1; i >= 0; i--) {
        const e = dagEdges[i];
        if (frame.pathNodes.includes(e.to)) continue;
        stack.push({
          node: e.to,
          pathNodes: [...frame.pathNodes, e.to],
          pathEdges: [...frame.pathEdges, e.kind],
          depth: frame.depth + 1,
        });
      }
    }

    if (paths.length > maxPathsPerTarget) truncated = true;
    const canonical = dedupAndSortPaths(paths).slice(0, maxPathsPerTarget);
    result.set(target, canonical);
  }

  return { paths: result, truncated };
}

function freezePath(nodes: ArticleKey[], edges: EdgeKind[]): PropagationPath {
  return Object.freeze({
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    length: nodes.length - 1,
  });
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
  out.sort(comparePropagationPaths);
  return out;
}

function comparePropagationPaths(a: PropagationPath, b: PropagationPath): number {
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
  index: ShortestPathIndex,
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
    const witness = selectWitness(article.key, paths, index, direct);
    const count = level === 'UNAFFECTED' ? 0 : (index.count.get(article.key) ?? 0);

    out.push({
      key: article.key,
      stableId: article.stableId,
      versionId: article.versionId,
      label: article.label,
      level,
      paths,
      shortestWitness: witness,
      equalLengthWitnessCount: count,
    });
  }
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return Object.freeze(out);
}

function selectWitness(
  key: ArticleKey,
  paths: ReadonlyArray<PropagationPath>,
  index: ShortestPathIndex,
  direct: ReadonlySet<ArticleKey>,
): PropagationPath | null {
  if (paths.length > 0) return paths[0] ?? null;
  if (direct.has(key)) {
    return Object.freeze({
      nodes: Object.freeze([key]),
      edges: Object.freeze([]),
      length: 0,
    });
  }
  if (!index.distance.has(key)) return null;
  return deriveLexicographicallySmallestPath(key, index);
}

function deriveLexicographicallySmallestPath(
  target: ArticleKey,
  index: ShortestPathIndex,
): PropagationPath {
  const dist = index.distance.get(target) ?? 0;
  const nodes: ArticleKey[] = new Array(dist + 1);
  const edges: EdgeKind[] = new Array(dist);
  let current: ArticleKey = target;
  let remaining = dist;
  while (remaining > 0) {
    nodes[remaining] = current;
    const preds = index.predecessors.get(current) ?? [];
    const chosen = [...preds].sort(compareTraversalEdges)[0];
    if (!chosen) break;
    edges[remaining - 1] = chosen.kind;
    current = chosen.from;
    remaining--;
  }
  nodes[0] = current;
  return freezePath(nodes, edges);
}

function buildRuleImpacts(
  graph: BuiltGraph,
  direct: ReadonlySet<ArticleKey>,
  indirect: ReadonlySet<ArticleKey>,
  pathMap: PathEnumerationResult,
  index: ShortestPathIndex,
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
    const canonical = dedupAndSortPaths(paths);
    const witness = pickRuleWitness(level, directArticles, indirectArticles, canonical, index);
    const count = computeRuleWitnessCount(level, directArticles, indirectArticles, index);

    out.push({
      ruleId: rule.ruleId,
      level,
      articleKeys: Object.freeze(affected),
      paths: Object.freeze(canonical),
      shortestWitness: witness,
      equalLengthWitnessCount: count,
    });
  }
  out.sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0));
  return Object.freeze(out);
}

function pickRuleWitness(
  level: 'DIRECT' | 'INDIRECT' | 'UNAFFECTED',
  directArticles: ReadonlyArray<ArticleKey>,
  indirectArticles: ReadonlyArray<ArticleKey>,
  paths: ReadonlyArray<PropagationPath>,
  index: ShortestPathIndex,
): PropagationPath | null {
  if (level === 'UNAFFECTED') return null;
  if (paths.length > 0) return paths[0] ?? null;
  if (level === 'DIRECT' && directArticles.length > 0) {
    const first = [...directArticles].sort()[0] as ArticleKey;
    return Object.freeze({
      nodes: Object.freeze([first]),
      edges: Object.freeze([]),
      length: 0,
    });
  }
  const candidates = indirectArticles.length > 0 ? indirectArticles : directArticles;
  if (candidates.length === 0) return null;
  let best: PropagationPath | null = null;
  for (const k of candidates) {
    const p = deriveLexicographicallySmallestPath(k, index);
    if (!best || comparePropagationPaths(p, best) < 0) best = p;
  }
  return best;
}

function computeRuleWitnessCount(
  level: 'DIRECT' | 'INDIRECT' | 'UNAFFECTED',
  directArticles: ReadonlyArray<ArticleKey>,
  indirectArticles: ReadonlyArray<ArticleKey>,
  index: ShortestPathIndex,
): number {
  if (level === 'UNAFFECTED') return 0;
  if (level === 'DIRECT') {
    let total = 0;
    for (const k of directArticles) total += index.count.get(k) ?? 0;
    return Math.min(total, MAX_EQUAL_LENGTH_COUNT);
  }
  let total = 0;
  const minDist = Math.min(
    ...[...directArticles, ...indirectArticles].map(
      (k) => index.distance.get(k) ?? Number.MAX_SAFE_INTEGER,
    ),
  );
  for (const k of [...directArticles, ...indirectArticles]) {
    if ((index.distance.get(k) ?? Number.MAX_SAFE_INTEGER) === minDist) {
      total += index.count.get(k) ?? 0;
    }
  }
  return Math.min(total, MAX_EQUAL_LENGTH_COUNT);
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
    if (inFrom && inTo) continue;
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
