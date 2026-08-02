import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalStringify } from '../common/canonical-json';
import { computeImpact } from '../domain/impact';
import { parseImportDocument } from '../imports/import-document';
import { DatabaseService } from './database.service';
import { GraphRepository } from './graph.repository';
import type { ImpactQuery, RevisionGraph } from '../domain/types';

/**
 * Proves the immutability requirement through the real SQLite adapter: because
 * upserts key on primary keys, importing the same shared-node document twice
 * (and in reversed record order) reloads to a byte-identical graph, so the pure
 * evaluator yields a byte-identical result, path set, and diagnostics.
 */

const QUERY: ImpactQuery = {
  fromVersion: 'LAW-V1',
  toVersion: 'LAW-DRAFT-2',
  asOf: '2026-08-02T00:00:00.000Z',
};

function loadMaterial(name: string): RevisionGraph {
  const raw = readFileSync(join(__dirname, '..', '..', 'materials', name), 'utf8');
  return parseImportDocument(JSON.parse(raw));
}

function reverseGraph(graph: RevisionGraph): RevisionGraph {
  return {
    versions: [...graph.versions].reverse(),
    articles: [...graph.articles].reverse(),
    references: [...graph.references].reverse(),
    succession: [...graph.succession].reverse(),
    bindings: [...graph.bindings].reverse(),
  };
}

function freshRepository(): { database: DatabaseService; graph: GraphRepository } {
  process.env['DATABASE_PATH'] = ':memory:';
  const database = new DatabaseService();
  database.onModuleInit();
  return { database, graph: new GraphRepository(database) };
}

describe('GraphRepository idempotent re-import (shared-node material)', () => {
  const material = loadMaterial('draft-2-shared-node.json');

  it('yields a byte-identical result after importing the same document twice', () => {
    const once = freshRepository();
    once.graph.upsertGraph(material);
    const singleResult = computeImpact(once.graph.loadGraph(), QUERY);
    once.database.onModuleDestroy();

    const twice = freshRepository();
    twice.graph.upsertGraph(material);
    twice.graph.upsertGraph(material); // duplicate import must not duplicate rows
    const doubleResult = computeImpact(twice.graph.loadGraph(), QUERY);
    twice.database.onModuleDestroy();

    expect(canonicalStringify(doubleResult)).toEqual(canonicalStringify(singleResult));
    expect(doubleResult.paths).toEqual(singleResult.paths);
    expect(doubleResult.diagnostics).toEqual(singleResult.diagnostics);
  });

  it('yields a byte-identical result when records are imported in reversed order', () => {
    const forward = freshRepository();
    forward.graph.upsertGraph(material);
    const forwardResult = computeImpact(forward.graph.loadGraph(), QUERY);
    forward.database.onModuleDestroy();

    const reversed = freshRepository();
    reversed.graph.upsertGraph(reverseGraph(material));
    const reversedResult = computeImpact(reversed.graph.loadGraph(), QUERY);
    reversed.database.onModuleDestroy();

    expect(canonicalStringify(reversedResult)).toEqual(
      canonicalStringify(forwardResult),
    );
  });
});
