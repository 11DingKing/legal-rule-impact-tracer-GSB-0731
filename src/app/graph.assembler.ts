import { Injectable } from '@nestjs/common';
import type {
  ArticleInput,
  BindingInput,
  BuiltGraph,
  RevisionGraphInput,
  SuccessionInput,
  VersionInput,
  VersionStatus,
} from '../domain';
import { buildGraph, makeArticleKey } from '../domain';
import { RevisionRepository } from '../infra/database/revision.repository';

@Injectable()
export class GraphAssembler {
  constructor(private readonly repo: RevisionRepository) {}

  assemble(): BuiltGraph {
    const versions = this.repo.loadVersions();
    const articles = this.repo.loadArticles();
    const succession = this.repo.loadSuccessions();
    const bindings = this.repo.loadBindings();
    return buildGraph(versions, articles, succession, bindings);
  }
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
    const so: Record<VersionStatus, number> = {
      DRAFT: 0,
      PUBLISHED: 1,
      EFFECTIVE: 2,
    };
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
