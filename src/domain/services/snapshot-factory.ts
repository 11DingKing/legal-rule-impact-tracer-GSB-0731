import { randomUUID } from 'crypto';
import { SnapshotId } from '../models/branded-types';
import { ImpactReport } from '../models/impact-report';
import { ImpactSnapshot } from '../models/impact-snapshot';

export class SnapshotFactory {
  create(report: ImpactReport, now?: Date): ImpactSnapshot {
    const createdAt = (now ?? new Date()).toISOString();
    return Object.freeze({
      snapshotId: SnapshotId(randomUUID()),
      createdAt,
      report: Object.freeze(report),
    });
  }
}
