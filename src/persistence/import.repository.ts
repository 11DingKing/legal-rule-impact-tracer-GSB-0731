import { Injectable } from "@nestjs/common";
import { DatabaseService } from "./database.service";

export interface ImportBatch {
  readonly id: string;
  readonly contentHash: string;
  readonly importedAt: string;
}

interface BatchRow {
  id: string;
  content_hash: string;
  imported_at: string;
}

function toBatch(row: BatchRow): ImportBatch {
  return {
    id: row.id,
    contentHash: row.content_hash,
    importedAt: row.imported_at,
  };
}

@Injectable()
export class ImportRepository {
  constructor(private readonly database: DatabaseService) {}

  findByContentHash(contentHash: string): ImportBatch | null {
    const row = this.database
      .connection()
      .prepare(
        "SELECT id, content_hash, imported_at FROM import_batches WHERE content_hash = ?",
      )
      .get(contentHash) as unknown as BatchRow | undefined;
    return row === undefined ? null : toBatch(row);
  }

  insert(batch: ImportBatch, payloadJson: string): void {
    this.database
      .connection()
      .prepare(
        "INSERT INTO import_batches (id, content_hash, imported_at, payload_json) VALUES (?, ?, ?, ?)",
      )
      .run(batch.id, batch.contentHash, batch.importedAt, payloadJson);
  }
}
