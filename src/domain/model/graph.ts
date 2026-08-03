import type {
  ArticleKey,
  ArticleNode,
  GraphEdge,
  RuleNode,
  VersionNode,
  VersionInput,
  ArticleInput,
  SuccessionInput,
  BindingInput,
  VersionStatus,
  DanglingReference,
} from './types';
import { makeArticleKey } from './article-key';

export interface BuiltGraph {
  readonly versions: ReadonlyMap<string, VersionNode>;
  readonly articlesByKey: ReadonlyMap<ArticleKey, ArticleNode>;
  readonly articlesByStable: ReadonlyMap<string, ReadonlyArray<ArticleNode>>;
  readonly edges: ReadonlyArray<GraphEdge>;
  readonly outgoing: ReadonlyMap<ArticleKey, ReadonlyArray<GraphEdge>>;
  readonly incoming: ReadonlyMap<ArticleKey, ReadonlyArray<GraphEdge>>;
  readonly rules: ReadonlyMap<string, RuleNode>;
  readonly danglingReferences: ReadonlyArray<DanglingReference>;
  readonly versionOrder: ReadonlyArray<string>;
}

function compareStatus(a: VersionStatus, b: VersionStatus): number {
  const order: Record<VersionStatus, number> = {
    DRAFT: 0,
    PUBLISHED: 1,
    EFFECTIVE: 2,
  };
  return order[a] - order[b];
}

function orderVersions(
  versions: ReadonlyArray<VersionInput>,
): ReadonlyArray<VersionNode> {
  const sorted = [...versions].sort((a, b) => {
    const dateA = a.effectiveFrom ?? '9999-12-31';
    const dateB = b.effectiveFrom ?? '9999-12-31';
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    if (a.status !== b.status) return compareStatus(a.status, b.status);
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  return sorted.map((v, idx) => ({ ...v, ordinal: idx }));
}

function toArray<T extends string>(value: T | ReadonlyArray<T>): ReadonlyArray<T> {
  if (Array.isArray(value)) {
    return value as ReadonlyArray<T>;
  }
  return [value as T];
}

export interface BuildOptions {
  readonly onDuplicateVersion?: (id: string) => void;
  readonly onDuplicateArticle?: (key: ArticleKey) => void;
}

export function buildGraph(
  versionsInput: ReadonlyArray<VersionInput>,
  articlesInput: ReadonlyArray<ArticleInput>,
  successionInput: ReadonlyArray<SuccessionInput>,
  bindingsInput: ReadonlyArray<BindingInput>,
  options: BuildOptions = {},
): BuiltGraph {
  const versionList = orderVersions(versionsInput);
  const versions = new Map<string, VersionNode>();
  for (const v of versionList) {
    if (versions.has(v.id)) {
      options.onDuplicateVersion?.(v.id);
      continue;
    }
    versions.set(v.id, v);
  }

  const articlesByKey = new Map<ArticleKey, ArticleNode>();
  const articlesByStable = new Map<string, ArticleNode[]>();

  for (const a of articlesInput) {
    const key = makeArticleKey(a.stableId, a.version);
    if (articlesByKey.has(key)) {
      options.onDuplicateArticle?.(key);
      continue;
    }
    const node: ArticleNode = {
      stableId: a.stableId,
      versionId: a.version,
      label: a.label,
      key,
    };
    articlesByKey.set(key, node);
    const byStable = articlesByStable.get(a.stableId);
    if (byStable) byStable.push(node);
    else articlesByStable.set(a.stableId, [node]);
  }

  for (const list of articlesByStable.values()) {
    list.sort((x, y) => {
      const vx = versions.get(x.versionId);
      const vy = versions.get(y.versionId);
      const ox = vx ? vx.ordinal : Number.MAX_SAFE_INTEGER;
      const oy = vy ? vy.ordinal : Number.MAX_SAFE_INTEGER;
      if (ox !== oy) return ox - oy;
      return x.versionId < y.versionId ? -1 : x.versionId > y.versionId ? 1 : 0;
    });
  }

  const edges: GraphEdge[] = [];
  const dangling: DanglingReference[] = [];

  for (const a of articlesInput) {
    const refs = a.references ?? [];
    for (const refStableId of refs) {
      const targetList = articlesByStable.get(refStableId);
      if (!targetList || targetList.length === 0) {
        dangling.push({
          fromKey: makeArticleKey(a.stableId, a.version),
          toStableId: refStableId,
          reason: 'REFERENCED_ARTICLE_NOT_FOUND',
        });
        continue;
      }
      const target = resolveReferenceTarget(
        a.version,
        targetList,
        versionList,
      );
      if (!target) {
        dangling.push({
          fromKey: makeArticleKey(a.stableId, a.version),
          toStableId: refStableId,
          reason: 'REFERENCED_VERSION_NOT_RESOLVABLE',
        });
        continue;
      }
      const fromKey = makeArticleKey(a.stableId, a.version);
      edges.push({
        from: fromKey,
        to: target.key,
        kind: 'REFERENCE',
        successionKind: null,
        ruleId: null,
        refStableId,
      });
    }
  }

  for (const s of successionInput) {
    const fromList = toArray(s.from);
    const toList = toArray(s.to);
    for (const fStable of fromList) {
      const fVersions = articlesByStable.get(fStable);
      const fNode = fVersions ? fVersions[fVersions.length - 1] : undefined;
      if (!fNode) continue;
      for (const tStable of toList) {
        const tVersions = articlesByStable.get(tStable);
        const tNode = tVersions ? tVersions[tVersions.length - 1] : undefined;
        if (!tNode) continue;
        edges.push({
          from: fNode.key,
          to: tNode.key,
          kind: 'SUCCESSION',
          successionKind: s.kind,
          ruleId: null,
          refStableId: null,
        });
      }
    }
  }

  const rules = new Map<string, RuleNode>();
  for (const b of bindingsInput) {
    const existing = rules.get(b.ruleId);
    const keys = b.articleIds
      .map((id) => {
        const list = articlesByStable.get(id);
        return list ? list[list.length - 1]?.key : undefined;
      })
      .filter((k): k is ArticleKey => k !== undefined);
    if (existing) {
      const merged = new Set([...existing.boundKeys, ...keys]);
      rules.set(b.ruleId, {
        ruleId: b.ruleId,
        boundKeys: Object.freeze([...merged].sort()),
      });
    } else {
      rules.set(b.ruleId, {
        ruleId: b.ruleId,
        boundKeys: Object.freeze([...new Set(keys)].sort()),
      });
    }
  }

  for (const rule of rules.values()) {
    for (const k of rule.boundKeys) {
      edges.push({
        from: k,
        to: k,
        kind: 'BOUND_RULE',
        successionKind: null,
        ruleId: rule.ruleId,
        refStableId: null,
      });
    }
  }

  edges.sort(compareEdges);

  const outgoing = new Map<ArticleKey, GraphEdge[]>();
  const incoming = new Map<ArticleKey, GraphEdge[]>();
  for (const e of edges) {
    const outList = outgoing.get(e.from);
    if (outList) outList.push(e);
    else outgoing.set(e.from, [e]);
    if (e.from !== e.to) {
      const inList = incoming.get(e.to);
      if (inList) inList.push(e);
      else incoming.set(e.to, [e]);
    }
  }

  return {
    versions,
    articlesByKey,
    articlesByStable,
    edges: Object.freeze(edges),
    outgoing,
    incoming,
    rules,
    danglingReferences: Object.freeze(dangling),
    versionOrder: Object.freeze(versionList.map((v) => v.id)),
  };
}

function resolveReferenceTarget(
  fromVersionId: string,
  targetList: ReadonlyArray<ArticleNode>,
  allVersions: ReadonlyArray<VersionNode>,
): ArticleNode | undefined {
  const sameVersion = targetList.find((t) => t.versionId === fromVersionId);
  if (sameVersion) return sameVersion;
  const fromVer = allVersions.find((v) => v.id === fromVersionId);
  if (!fromVer) return targetList[targetList.length - 1];
  let candidate: ArticleNode | undefined;
  for (const t of targetList) {
    const tv = allVersions.find((v) => v.id === t.versionId);
    if (!tv) continue;
    if (tv.ordinal <= fromVer.ordinal) candidate = t;
  }
  return candidate ?? targetList[0];
}

function compareEdges(a: GraphEdge, b: GraphEdge): number {
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  if (a.to !== b.to) return a.to < b.to ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.successionKind !== b.successionKind) {
    const sa = a.successionKind ?? '';
    const sb = b.successionKind ?? '';
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  const ra = a.ruleId ?? '';
  const rb = b.ruleId ?? '';
  if (ra !== rb) return ra < rb ? -1 : 1;
  const refA = a.refStableId ?? '';
  const refB = b.refStableId ?? '';
  return refA < refB ? -1 : refA > refB ? 1 : 0;
}
