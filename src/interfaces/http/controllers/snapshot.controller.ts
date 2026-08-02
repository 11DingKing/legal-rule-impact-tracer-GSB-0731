import {
  Controller,
  Get,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { SnapshotService } from '../../../application/services/snapshot.service';
import { SnapshotNotFoundError } from '../../../domain';

@Controller('api/v1/snapshots')
export class SnapshotController {
  constructor(private readonly snapshotService: SnapshotService) {}

  @Get()
  listSnapshots() {
    return this.snapshotService.findAll();
  }

  @Get(':id')
  getSnapshot(@Param('id') id: string) {
    try {
      return this.snapshotService.findById(id);
    } catch (err) {
      if (err instanceof SnapshotNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}
