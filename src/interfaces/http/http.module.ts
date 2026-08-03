import { Module } from '@nestjs/common';
import { ImportController } from './controllers/import.controller';
import { ImpactController } from './controllers/impact.controller';
import { SnapshotController } from './controllers/snapshot.controller';
import { BackfillController } from './controllers/backfill.controller';
import { ImportService } from '../../application/services/import.service';
import { ImpactQueryService } from '../../application/services/impact-query.service';
import { SnapshotService } from '../../application/services/snapshot.service';
import { BackfillService } from '../../application/services/backfill.service';

@Module({
  controllers: [
    ImportController,
    ImpactController,
    SnapshotController,
    BackfillController,
  ],
  providers: [
    ImportService,
    ImpactQueryService,
    SnapshotService,
    BackfillService,
  ],
})
export class HttpModule {}
