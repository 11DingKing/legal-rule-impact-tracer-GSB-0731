import { Controller, Get, Param } from '@nestjs/common';
import {
  SnapshotsService,
  type ReplayResult,
  type SnapshotView,
} from './snapshots.service';

/** HTTP boundary for reading and replaying immutable snapshots. */
@Controller('snapshots')
export class SnapshotsController {
  constructor(private readonly snapshotsService: SnapshotsService) {}

  @Get(':id')
  getSnapshot(@Param('id') id: string): SnapshotView {
    return this.snapshotsService.getSnapshot(id);
  }

  @Get(':id/replay')
  replay(@Param('id') id: string): ReplayResult {
    return this.snapshotsService.replay(id);
  }
}
