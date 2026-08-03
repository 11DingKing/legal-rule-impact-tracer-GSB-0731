import { SnapshotId } from './branded-types';
import { ImpactReport } from './impact-report';

export interface ImpactSnapshot {
  readonly snapshotId: SnapshotId;
  readonly createdAt: string;
  readonly report: ImpactReport;
}
