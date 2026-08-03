import { Module } from "@nestjs/common";
import { ImpactModule } from "./impact/impact.module";
import { ImportsModule } from "./imports/imports.module";
import { PersistenceModule } from "./persistence/persistence.module";
import { SnapshotsModule } from "./snapshots/snapshots.module";

@Module({
  imports: [PersistenceModule, ImportsModule, ImpactModule, SnapshotsModule],
})
export class AppModule {}
