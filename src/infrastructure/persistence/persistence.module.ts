import { Module, Global } from '@nestjs/common';
import { SqliteService } from './sqlite/sqlite.service';
import { GraphRepository } from './repositories/graph.repository';
import { SnapshotRepository } from './repositories/snapshot.repository';

@Global()
@Module({
  providers: [SqliteService, GraphRepository, SnapshotRepository],
  exports: [SqliteService, GraphRepository, SnapshotRepository],
})
export class PersistenceModule {}
