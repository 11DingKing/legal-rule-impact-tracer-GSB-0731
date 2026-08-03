import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { GraphRepository } from './graph.repository';
import { ImportRepository } from './import.repository';
import { SnapshotRepository } from './snapshot.repository';

@Module({
  providers: [
    DatabaseService,
    GraphRepository,
    ImportRepository,
    SnapshotRepository,
  ],
  exports: [
    DatabaseService,
    GraphRepository,
    ImportRepository,
    SnapshotRepository,
  ],
})
export class PersistenceModule {}
