import { Injectable } from '@nestjs/common';
import { SqliteService } from '../sqlite/sqlite.service';
import {
  ImpactReport,
  ImpactSnapshot,
  SnapshotId,
} from '../../../domain';

interface SnapshotRow {
  snapshot_id: string;
  created_at: string;
  source_version_id: string;
  target_version_id: string;
  queried_at: string;
  graph_fingerprint: string;
  edge_sequence_hash: string;
  report_json: string;
}

@Injectable()
export class SnapshotRepository {
  constructor(private readonly sqlite: SqliteService) {}

  save(snapshot: ImpactSnapshot): void {
    const db = this.sqlite.getDb();
    const stmt = db.prepare(
      `INSERT INTO snapshots
        (snapshot_id, created_at, source_version_id, target_version_id,
         queried_at, graph_fingerprint, edge_sequence_hash, report_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      snapshot.snapshotId,
      snapshot.createdAt,
      snapshot.report.sourceVersionId,
      snapshot.report.targetVersionId,
      snapshot.report.queriedAt,
      snapshot.report.graphFingerprint,
      snapshot.report.edgeSequence.hash,
      JSON.stringify(snapshot.report),
    );
  }

  findById(snapshotId: SnapshotId): ImpactSnapshot | null {
    const db = this.sqlite.getDb();
    const row = db
      .prepare(`SELECT * FROM snapshots WHERE snapshot_id = ?`)
      .get(snapshotId) as SnapshotRow | undefined;
    if (!row) return null;
    return this.rowToSnapshot(row);
  }

  findAll(): ImpactSnapshot[] {
    const db = this.sqlite.getDb();
    const rows = db
      .prepare(
        `SELECT * FROM snapshots ORDER BY created_at DESC, snapshot_id ASC`,
      )
      .all() as SnapshotRow[];
    return rows.map((r) => this.rowToSnapshot(r));
  }

  private rowToSnapshot(row: SnapshotRow): ImpactSnapshot {
    const report = JSON.parse(row.report_json) as ImpactReport;
    return Object.freeze({
      snapshotId: row.snapshot_id as SnapshotId,
      createdAt: row.created_at,
      report: Object.freeze(report),
    });
  }
}
