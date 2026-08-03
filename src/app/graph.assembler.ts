import { Injectable } from '@nestjs/common';
import type {
  ArticleInput,
  ArticleNode,
  BindingInput,
  BuiltGraph,
  GraphEdge,
  RevisionGraphInput,
  RuleNode,
  SuccessionInput,
  VersionInput,
  VersionNode,
  VersionStatus,
} from '../domain';
import { makeArticleKey } from '../domain';
import { RevisionRepository } from '../infra/database/revision.repository';

@Injectable()
export class GraphAssembler {
  constructor(private readonly repo: RevisionRepository) {}

  assemble(): BuiltGraph {
    const versionRows = this.repo.loadAllVersions();
    const articleRows = this.repo.loadAllArticles();
    const refRows = this.repo.loadAllReferences();
    const succRows = this.repo.loadAllSuccessions();
    const bindingRows = this.repo.loadAllBindings();

    const versions = new Map<string, VersionNode>();
    for (const r of versionRows) {
      versions.set(r.id, {
        id: r.id,
        status: r.status as VersionStatus,
        effectiveFrom: r.effective_from,
        ordinal: r.ordinal,
      });
    }

    const articlesByKey = new Map<string, ArticleNode>();
    const articlesByStable = new Map<string, ArticleNode[]>();
    for (const r of articleRows) {
      const node: ArticleNode = {
        stableId: r.stable_id,
        versionId: r.version_id,
        label: r.label,
        key: r.article_key,
      };
      articlesByKey.set(node.key, node);
      const list = articlesByStable.get(node.stableId);
      if (list) list.push(node);
      else articlesByStable.set(node.stableId, [node]);
    }
    for (const list of articlesByStable.values()) {
      list.sort((a, b) => {
        const va = versions.get(a.versionId);
        const vb = versions.get(b.versionId);
        const oa = va ? va.ordinal : Number.MAX_SAFE_INTEGER;
        const ob = vb ? vb.ordinal : Number.MAX_SAFE_INTEGER;
        if (oa !== ob) return oa - ob;
        return a.versionId < b.versionId ? -1 : 1;
      });
    }

    const edges: GraphEdge[] = [];

    for (const r of refRows) {
      if (r.resolved === 1 && r.to_key) {
        edges.push({
          from: r.from_key,
          to: r.to_key,
          kind: 'REFERENCE',
          successionKind: null,
          ruleId: null,
          refStableId: r.to_stable_id,
        });
      }
    }

    for (const r of succRows) {
      edges.push({
        from: r.from_key,
        to: r.to_key,
        kind: 'SUCCESSION',
        successionKind: r.kind as GraphEdge['successionKind'],
        ruleId: null,
        refStableId: null,
      });
    }

    const rules = new Map<string, RuleNode>();
    for (const r of bindingRows) {
      const existing = rules.get(r.rule_id);
      if (existing) {
        const merged = Object.freeze(
          [...new Set([...existing.boundKeys, r.article_key])].sort(),
        );
        rules.set(r.rule_id, { ruleId: r.rule_id, boundKeys: merged });
      } else {
        rules.set(r.rule_id, {
          ruleId: r.rule_id,
          boundKeys: Object.freeze([r.article_key]),
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

    const outgoing = new Map<string, GraphEdge[]>();
    const incoming = new Map<string, GraphEdge[]>();
    for (const e of edges) {
      const out = outgoing.get(e.from);
      if (out) out.push(e);
      else outgoing.set(e.from, [e]);
      if (e.from !== e.to) {
        const inn = incoming.get(e.to);
        if (inn) inn.push(e);
        else incoming.set(e.to, [e]);
      }
    }

    const dangling = refRows
      .filter((r) => r.resolved === 0)
      .map((r) => ({
        fromKey: r.from_key,
        toStableId: r.to_stable_id,
        reason: 'REFERENCED_ARTICLE_NOT_FOUND',
      }));

    return {
      versions,
      articlesByKey,
      articlesByStable,
      edges: Object.freeze(edges),
      outgoing,
      incoming,
      rules,
      danglingReferences: Object.freeze(dangling),
      versionOrder: Object.freeze([...versions.values()].sort((a, b) => a.ordinal - b.ordinal).map((v) => v.id)),
    };
  }
}

function compareEdges(a: GraphEdge, b: GraphEdge): number {
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  if (a.to !== b.to) return a.to < b.to ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  const sa = a.successionKind ?? '';
  const sb = b.successionKind ?? '';
  if (sa !== sb) return sa < sb ? -1 : sa > sb ? 1 : 0;
  const ra = a.ruleId ?? '';
  const rb = b.ruleId ?? '';
  if (ra !== rb) return ra < rb ? -1 : 1;
  const refA = a.refStableId ?? '';
  const refB = b.refStableId ?? '';
  return refA < refB ? -1 : refA > refB ? 1 : 0;
}

export function normalizeInput(
  input: RevisionGraphInput,
): {
  versions: ReadonlyArray<VersionInput>;
  articles: ReadonlyArray<ArticleInput>;
  succession: ReadonlyArray<SuccessionInput>;
  bindings: ReadonlyArray<BindingInput>;
  ordinals: ReadonlyMap<string, number>;
} {
  const sorted = [...input.versions].sort((a, b) => {
    const da = a.effectiveFrom ?? '9999-12-31';
    const db = b.effectiveFrom ?? '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    const so: Record<VersionStatus, number> = { DRAFT: 0, PUBLISHED: 1, EFFECTIVE: 2 };
    if (a.status !== b.status) return so[a.status] - so[b.status];
    return a.id < b.id ? -1 : 1;
  });
  const ordinals = new Map<string, number>();
  sorted.forEach((v, i) => ordinals.set(v.id, i));
  return {
    versions: sorted,
    articles: input.articles,
    succession: input.succession,
    bindings: input.bindings,
    ordinals,
  };
}

export function extractReferences(
  articles: ReadonlyArray<ArticleInput>,
): ReadonlyArray<{ readonly fromKey: string; readonly toStableId: string }> {
  const out: { fromKey: string; toStableId: string }[] = [];
  for (const a of articles) {
    const fromKey = makeArticleKey(a.stableId, a.version);
    for (const ref of a.references ?? []) {
      out.push({ fromKey, toStableId: ref });
    }
  }
  return out;
}
