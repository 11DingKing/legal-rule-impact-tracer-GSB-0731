import { Module } from '@nestjs/common';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { HttpModule } from './interfaces/http/http.module';

@Module({
  imports: [PersistenceModule, HttpModule],
})
export class AppModule {}
