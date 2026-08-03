import { Controller, Get, Param } from "@nestjs/common";
import { SnapshotsService } from "./snapshots.service";

@Controller("snapshots")
export class SnapshotsController {
  constructor(private readonly snapshotsService: SnapshotsService) {}

  @Get(":id")
  getSnapshot(@Param("id") id: string) {
    return this.snapshotsService.getSnapshot(id);
  }

  @Get(":id/replay")
  replay(@Param("id") id: string) {
    return this.snapshotsService.replay(id);
  }
}
