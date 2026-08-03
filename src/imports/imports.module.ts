import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [PersistenceModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
