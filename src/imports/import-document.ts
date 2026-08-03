import { BadRequestException } from '@nestjs/common';
import { SUCCESSION_KINDS, VERSION_STATUSES } from '../domain/types';
import type {
  Article,
  ReferenceEdge,
  RevisionGraph,
  RuleBinding,
  SuccessionEdge,
  SuccessionKind,
  VersionStatus,
} from '../domain/types';

/**
 * Parse and validate a raw import document into a normalized RevisionGraph.
 *
 * This is a pure function (no I/O) intentionally kept out of the domain module
 * because it deals with the untrusted wire format. It rejects malformed input
 * with actionable messages and expands the compact wire shape (articles carry
 * their own `references`; succession lists multiple targets under one `to`)
 * into the flat edge lists the domain evaluator expects.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(path: string, expectation: string): never {
  throw new BadRequestException(
    `Invalid import document at ${path}: expected ${expectation}`,
  );
}

function readString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path}.${key}`, 'a non-empty string');
  }
  return value;
}

function readStringOrNull(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string | null {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    fail(`${path}.${key}`, 'a string or null');
  }
  return value;
}

function readArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    fail(`${path}.${key}`, 'an array');
  }
  return value;
}

function readStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    fail(path, 'an array of strings');
  }
  const result: string[] = [];
  value.forEach((item, index) => {
    if (typeof item !== 'string' || item.length === 0) {
      fail(`${path}[${index}]`, 'a non-empty string');
    }
    result.push(item);
  });
  return result;
}

function readVersionStatus(
  record: Record<string, unknown>,
  key: string,
  path: string,
): VersionStatus {
  const value = record[key];
  const match = VERSION_STATUSES.find((status) => status === value);
  if (match === undefined) {
    fail(`${path}.${key}`, `one of ${VERSION_STATUSES.join(', ')}`);
  }
  return match;
}

function readSuccessionKind(
  record: Record<string, unknown>,
  key: string,
  path: string,
): SuccessionKind {
  const value = record[key];
  const match = SUCCESSION_KINDS.find((kind) => kind === value);
  if (match === undefined) {
    fail(`${path}.${key}`, `one of ${SUCCESSION_KINDS.join(', ')}`);
  }
  return match;
}

export function parseImportDocument(body: unknown): RevisionGraph {
  if (!isRecord(body)) {
    fail('$', 'an object');
  }

  const versions = readArray(body, 'versions', '$').map((raw, index) => {
    const path = `$.versions[${index}]`;
    if (!isRecord(raw)) {
      fail(path, 'an object');
    }
    return {
      id: readString(raw, 'id', path),
      status: readVersionStatus(raw, 'status', path),
      effectiveFrom: readStringOrNull(raw, 'effectiveFrom', path),
    };
  });

  const articles: Article[] = [];
  const references: ReferenceEdge[] = [];
  readArray(body, 'articles', '$').forEach((raw, index) => {
    const path = `$.articles[${index}]`;
    if (!isRecord(raw)) {
      fail(path, 'an object');
    }
    const stableId = readString(raw, 'stableId', path);
    const versionId = readString(raw, 'version', path);
    articles.push({ stableId, versionId, label: readString(raw, 'label', path) });
    const cited = raw['references'];
    if (cited !== undefined) {
      for (const toId of readStringArray(cited, `${path}.references`)) {
        references.push({ versionId, fromId: stableId, toId });
      }
    }
  });

  const succession: SuccessionEdge[] = [];
  readArray(body, 'succession', '$').forEach((raw, index) => {
    const path = `$.succession[${index}]`;
    if (!isRecord(raw)) {
      fail(path, 'an object');
    }
    const fromId = readString(raw, 'from', path);
    const kind = readSuccessionKind(raw, 'kind', path);
    for (const toId of readStringArray(raw['to'], `${path}.to`)) {
      succession.push({ fromId, toId, kind });
    }
  });

  const bindings: RuleBinding[] = [];
  readArray(body, 'bindings', '$').forEach((raw, index) => {
    const path = `$.bindings[${index}]`;
    if (!isRecord(raw)) {
      fail(path, 'an object');
    }
    const ruleId = readString(raw, 'ruleId', path);
    for (const articleId of readStringArray(raw['articleIds'], `${path}.articleIds`)) {
      bindings.push({ ruleId, articleId });
    }
  });

  const knownVersions = new Set(versions.map((version) => version.id));
  for (const article of articles) {
    if (!knownVersions.has(article.versionId)) {
      fail(
        '$.articles',
        `version "${article.versionId}" to be declared in $.versions`,
      );
    }
  }

  return { versions, articles, references, succession, bindings };
}
