import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service';

export interface SnapshotRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly queryJson: string;
  readonly graphJson: string;
  readonly resultJson: string;
  readonly graphHash: string;
}

type Row = Record<string, unknown>;

function asString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected string column, received ${typeof value}`);
  }
  return value;
}

function toRecord(row: Row): SnapshotRecord {
  return {
    id: asString(row['id']),
    createdAt: asString(row['created_at']),
    queryJson: asString(row['query_json']),
    graphJson: asString(row['graph_json']),
    resultJson: asString(row['result_json']),
    graphHash: asString(row['graph_hash']),
  };
}

/**
 * Append-only store for immutable query snapshots. Only INSERT and SELECT are
 * exposed — there is deliberately no update or delete — so a snapshot's frozen
 * query, graph, and result can never drift once written.
 */
@Injectable()
export class SnapshotRepository {
  constructor(private readonly database: DatabaseService) {}

  insert(record: SnapshotRecord): void {
    this.database
      .connection()
      .prepare(
        `INSERT INTO snapshots (id, created_at, query_json, graph_json, result_json, graph_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.createdAt,
        record.queryJson,
        record.graphJson,
        record.resultJson,
        record.graphHash,
      );
  }

  findById(id: string): SnapshotRecord | null {
    const row = this.database
      .connection()
      .prepare(
        `SELECT id, created_at, query_json, graph_json, result_json, graph_hash
         FROM snapshots WHERE id = ?`,
      )
      .get(id) as Row | undefined;
    return row === undefined ? null : toRecord(row);
  }

  list(): SnapshotRecord[] {
    const rows = this.database
      .connection()
      .prepare(
        `SELECT id, created_at, query_json, graph_json, result_json, graph_hash
         FROM snapshots ORDER BY created_at, id`,
      )
      .all() as Row[];
    return rows.map(toRecord);
  }
}
