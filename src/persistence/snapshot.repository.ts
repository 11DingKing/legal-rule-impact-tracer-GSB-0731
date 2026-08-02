import { Injectable } from "@nestjs/common";
import { DatabaseService } from "./database.service";

export interface SnapshotRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly queryJson: string;
  readonly graphJson: string;
  readonly resultJson: string;
}

interface SnapshotRow {
  id: string;
  created_at: string;
  query_json: string;
  graph_json: string;
  result_json: string;
}

function toRecord(row: SnapshotRow): SnapshotRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    queryJson: row.query_json,
    graphJson: row.graph_json,
    resultJson: row.result_json,
  };
}

/**
 * Append-only snapshot store. There is intentionally no update or delete
 * method: a snapshot, once written, can never be mutated through this API.
 */
@Injectable()
export class SnapshotRepository {
  constructor(private readonly database: DatabaseService) {}

  insert(record: SnapshotRecord): void {
    this.database
      .connection()
      .prepare(
        `INSERT INTO snapshots (id, created_at, query_json, graph_json, result_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.createdAt,
        record.queryJson,
        record.graphJson,
        record.resultJson,
      );
  }

  findById(id: string): SnapshotRecord | null {
    const row = this.database
      .connection()
      .prepare(
        "SELECT id, created_at, query_json, graph_json, result_json FROM snapshots WHERE id = ?",
      )
      .get(id) as unknown as SnapshotRow | undefined;
    return row === undefined ? null : toRecord(row);
  }

  list(): readonly SnapshotRecord[] {
    const rows = this.database
      .connection()
      .prepare(
        "SELECT id, created_at, query_json, graph_json, result_json FROM snapshots ORDER BY created_at, id",
      )
      .all() as unknown as SnapshotRow[];
    return rows.map(toRecord);
  }
}
