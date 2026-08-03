import { Module } from '@nestjs/common';
import { AppServicesModule } from './app/app-services.module';
import {
  ImpactController,
  SnapshotController,
} from './interface/http/impact.controller';
import { ImportController } from './interface/http/import.controller';

@Module({
  imports: [AppServicesModule],
  controllers: [ImportController, ImpactController, SnapshotController],
})
export class AppModule {}
