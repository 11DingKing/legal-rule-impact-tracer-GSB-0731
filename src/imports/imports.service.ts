import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { canonicalStringify } from '../common/canonical-json';
import { GraphRepository } from '../persistence/graph.repository';
import { ImportRepository } from '../persistence/import.repository';
import { parseImportDocument } from './import-document';
import type { RevisionGraph } from '../domain/types';

export interface ImportCounts {
  readonly versions: number;
  readonly articles: number;
  readonly references: number;
  readonly successionEdges: number;
  readonly bindings: number;
}

export interface ImportResult {
  readonly batchId: string;
  readonly contentHash: string;
  readonly importedAt: string;
  readonly deduplicated: boolean;
  readonly counts: ImportCounts;
}

function countsOf(document: RevisionGraph): ImportCounts {
  return {
    versions: document.versions.length,
    articles: document.articles.length,
    references: document.references.length,
    successionEdges: document.succession.length,
    bindings: document.bindings.length,
  };
}

/**
 * Validates a raw import, persists the graph, and records the batch. Identical
 * documents (by canonical content hash) are recognized and reported as
 * deduplicated without a second write, so repeated imports are safe.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly imports: ImportRepository,
    private readonly graph: GraphRepository,
  ) {}

  importDocument(body: unknown): ImportResult {
    const document = parseImportDocument(body);
    const contentHash = createHash('sha256')
      .update(canonicalStringify(document))
      .digest('hex');

    const existing = this.imports.findByContentHash(contentHash);
    if (existing !== null) {
      return {
        batchId: existing.id,
        contentHash: existing.contentHash,
        importedAt: existing.importedAt,
        deduplicated: true,
        counts: countsOf(document),
      };
    }

    const batchId = randomUUID();
    const importedAt = new Date().toISOString();
    this.graph.upsertGraph(document);
    this.imports.insert(
      { id: batchId, contentHash, importedAt },
      canonicalStringify(document),
    );
    return {
      batchId,
      contentHash,
      importedAt,
      deduplicated: false,
      counts: countsOf(document),
    };
  }
}
