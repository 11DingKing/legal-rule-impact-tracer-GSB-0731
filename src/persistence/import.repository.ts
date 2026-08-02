import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service';

export interface ImportBatch {
  readonly id: string;
  readonly contentHash: string;
  readonly importedAt: string;
}

type Row = Record<string, unknown>;

function asString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected string column, received ${typeof value}`);
  }
  return value;
}

function toBatch(row: Row): ImportBatch {
  return {
    id: asString(row['id']),
    contentHash: asString(row['content_hash']),
    importedAt: asString(row['imported_at']),
  };
}

/** Tracks import batches so identical re-imports are recognized by hash. */
@Injectable()
export class ImportRepository {
  constructor(private readonly database: DatabaseService) {}

  findByContentHash(contentHash: string): ImportBatch | null {
    const row = this.database
      .connection()
      .prepare(
        'SELECT id, content_hash, imported_at FROM import_batches WHERE content_hash = ?',
      )
      .get(contentHash) as Row | undefined;
    return row === undefined ? null : toBatch(row);
  }

  insert(batch: ImportBatch, payloadJson: string): void {
    this.database
      .connection()
      .prepare(
        'INSERT INTO import_batches (id, content_hash, imported_at, payload_json) VALUES (?, ?, ?, ?)',
      )
      .run(batch.id, batch.contentHash, batch.importedAt, payloadJson);
  }
}
