import { Injectable } from '@nestjs/common';
import { ImpactSnapshot, SnapshotId } from '../../domain';
import { SnapshotRepository } from '../../infrastructure/persistence/repositories/snapshot.repository';
import { SnapshotNotFoundError } from '../../domain';

@Injectable()
export class SnapshotService {
  constructor(private readonly snapshotRepo: SnapshotRepository) {}

  findById(snapshotId: string): ImpactSnapshot {
    const snapshot = this.snapshotRepo.findById(
      snapshotId as SnapshotId,
    );
    if (!snapshot) {
      throw new SnapshotNotFoundError(snapshotId);
    }
    return snapshot;
  }

  findAll(): ImpactSnapshot[] {
    return this.snapshotRepo.findAll();
  }
}
