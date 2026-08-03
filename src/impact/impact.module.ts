import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module";
import { ImpactController } from "./impact.controller";
import { ImpactService } from "./impact.service";

@Module({
  imports: [PersistenceModule],
  controllers: [ImpactController],
  providers: [ImpactService],
})
export class ImpactModule {}
