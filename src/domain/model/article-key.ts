import type { ArticleKey } from './types';

export function makeArticleKey(stableId: string, versionId: string): ArticleKey {
  return `${stableId}@${versionId}`;
}

export function parseArticleKey(key: ArticleKey): {
  readonly stableId: string;
  readonly versionId: string;
} {
  const idx = key.lastIndexOf('@');
  if (idx < 0) {
    throw new Error(`Invalid article key: ${key}`);
  }
  return {
    stableId: key.slice(0, idx),
    versionId: key.slice(idx + 1),
  };
}

export function stableIdOf(key: ArticleKey): string {
  return parseArticleKey(key).stableId;
}

export function versionIdOf(key: ArticleKey): string {
  return parseArticleKey(key).versionId;
}
