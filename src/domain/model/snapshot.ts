import { createHash, randomUUID } from 'crypto';
import type {
  ArticleNode,
  GraphEdge,
  ImpactQuery,
  ImpactResult,
  RuleNode,
  Snapshot,
  VersionNode,
} from './types';
import type { BuiltGraph } from './graph';
import { computeImpact } from './impact';
import type { ComputeOptions } from './impact';

export interface SnapshotInput {
  readonly graph: BuiltGraph;
  readonly query: ImpactQuery;
  readonly computeOptions?: ComputeOptions;
  readonly createdAt?: string;
}

export function createSnapshot(input: SnapshotInput): Snapshot {
  const { graph, query } = input;
  const createdAt = input.createdAt ?? new Date().toISOString();

  const frozenVersions: VersionNode[] = [];
  for (const id of graph.versionOrder) {
    const v = graph.versions.get(id);
    if (v) frozenVersions.push({ ...v });
  }

  const frozenArticles: ArticleNode[] = [];
  for (const a of graph.articlesByKey.values()) {
    frozenArticles.push({ ...a });
  }
  frozenArticles.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));

  const frozenEdges: GraphEdge[] = graph.edges.map((e) => ({ ...e }));

  const frozenRules: RuleNode[] = [];
  for (const r of graph.rules.values()) {
    frozenRules.push({
      ruleId: r.ruleId,
      boundKeys: Object.freeze([...r.boundKeys]),
    });
  }
  frozenRules.sort((a, b) =>
    a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0,
  );

  const graphHash = hashGraph(
    frozenVersions,
    frozenArticles,
    frozenEdges,
    frozenRules,
  );

  const frozenGraph: BuiltGraph = {
    versions: new Map(frozenVersions.map((v) => [v.id, v])),
    articlesByKey: new Map(frozenArticles.map((a) => [a.key, a])),
    articlesByStable: groupByStable(frozenArticles),
    edges: Object.freeze(frozenEdges),
    outgoing: buildAdjacency(frozenEdges, 'from'),
    incoming: buildAdjacency(frozenEdges, 'to'),
    rules: new Map(frozenRules.map((r) => [r.ruleId, r])),
    danglingReferences: graph.danglingReferences,
    versionOrder: Object.freeze([...graph.versionOrder]),
  };

  const result: ImpactResult = computeImpact(
    frozenGraph,
    query,
    input.computeOptions ?? {},
  );

  const snapshot: Snapshot = {
    id: randomUUID(),
    createdAt,
    query: { ...query },
    graphHash,
    frozenVersions: Object.freeze(frozenVersions),
    frozenArticles: Object.freeze(frozenArticles),
    frozenEdges: Object.freeze(frozenEdges),
    frozenRules: Object.freeze(frozenRules),
    result,
  };

  return Object.freeze(snapshot);
}

export function replaySnapshot(snapshot: Snapshot): ImpactResult {
  const graph: BuiltGraph = {
    versions: new Map(snapshot.frozenVersions.map((v) => [v.id, v])),
    articlesByKey: new Map(snapshot.frozenArticles.map((a) => [a.key, a])),
    articlesByStable: groupByStable(snapshot.frozenArticles),
    edges: snapshot.frozenEdges,
    outgoing: buildAdjacency(snapshot.frozenEdges, 'from'),
    incoming: buildAdjacency(snapshot.frozenEdges, 'to'),
    rules: new Map(snapshot.frozenRules.map((r) => [r.ruleId, r])),
    danglingReferences: snapshot.result.danglingReferences,
    versionOrder: Object.freeze(
      snapshot.frozenVersions
        .slice()
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((v) => v.id),
    ),
  };
  return computeImpact(graph, snapshot.query);
}

function groupByStable(
  articles: ReadonlyArray<ArticleNode>,
): ReadonlyMap<string, ReadonlyArray<ArticleNode>> {
  const map = new Map<string, ArticleNode[]>();
  for (const a of articles) {
    const list = map.get(a.stableId);
    if (list) list.push(a);
    else map.set(a.stableId, [a]);
  }
  return map;
}

function buildAdjacency(
  edges: ReadonlyArray<GraphEdge>,
  direction: 'from' | 'to',
): ReadonlyMap<string, ReadonlyArray<GraphEdge>> {
  const map = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    const key = direction === 'from' ? e.from : e.to;
    const list = map.get(key);
    if (list) list.push(e);
    else map.set(key, [e]);
  }
  return map;
}

function hashGraph(
  versions: ReadonlyArray<VersionNode>,
  articles: ReadonlyArray<ArticleNode>,
  edges: ReadonlyArray<GraphEdge>,
  rules: ReadonlyArray<RuleNode>,
): string {
  const h = createHash('sha256');
  h.update('VERSIONS\n');
  for (const v of versions) {
    h.update(`${v.id}|${v.status}|${v.effectiveFrom ?? ''}|${v.ordinal}\n`);
  }
  h.update('ARTICLES\n');
  for (const a of articles) {
    h.update(`${a.key}|${a.label}\n`);
  }
  h.update('EDGES\n');
  for (const e of edges) {
    h.update(
      `${e.from}|${e.to}|${e.kind}|${e.successionKind ?? ''}|${e.ruleId ?? ''}|${e.refStableId ?? ''}|${e.recordedAt}|${e.fromVersionId}|${e.toVersionId}\n`,
    );
  }
  h.update('RULES\n');
  for (const r of rules) {
    h.update(`${r.ruleId}|${[...r.boundKeys].sort().join(',')}\n`);
  }
  return h.digest('hex');
}
