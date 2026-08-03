import { Module } from '@nestjs/common';
import { DatabaseService } from '../infra/database/database.service';
import { RevisionRepository } from '../infra/database/revision.repository';
import { GraphAssembler } from './graph.assembler';
import { ImportService } from './import.service';
import { ImpactService } from './impact.service';

@Module({
  providers: [
    DatabaseService,
    RevisionRepository,
    GraphAssembler,
    ImportService,
    ImpactService,
  ],
  exports: [ImportService, ImpactService, DatabaseService, RevisionRepository, GraphAssembler],
})
export class AppServicesModule {}
