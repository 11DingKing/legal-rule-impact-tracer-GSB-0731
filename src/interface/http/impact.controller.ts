import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ImpactService } from '../../app/impact.service';
import { ImpactQueryDto } from './dto';
import type { ImpactQuery } from '../../domain';

@Controller('api/impact')
export class ImpactController {
  constructor(private readonly impactService: ImpactService) {}

  @Post('query')
  query(@Body() dto: ImpactQueryDto) {
    const query: ImpactQuery = {
      fromVersionId: dto.fromVersionId,
      toVersionId: dto.toVersionId,
      queryAt: dto.queryAt ?? new Date().toISOString(),
      includeDrafts: dto.includeDrafts ?? false,
      maxPathLength: dto.maxPathLength,
      maxPathsPerTarget: dto.maxPathsPerTarget,
    };
    const { result, snapshot, cacheHit } = this.impactService.queryImpact(query);
    return {
      snapshotId: snapshot.id,
      graphHash: snapshot.graphHash,
      queryHash: result.context.graphHash,
      cacheHit,
      createdAt: snapshot.createdAt,
      result,
    };
  }
}

@Controller('api/snapshots')
export class SnapshotController {
  constructor(private readonly impactService: ImpactService) {}

  @Get()
  list() {
    return this.impactService.listSnapshots();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.impactService.getSnapshot(id);
  }

  @Post(':id/replay')
  replay(@Param('id') id: string) {
    return this.impactService.replaySnapshot(id);
  }
}
