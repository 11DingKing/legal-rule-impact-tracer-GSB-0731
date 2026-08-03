import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { LawVersion } from '../domain/types';
import { GraphRepository } from '../persistence/graph.repository';
import { ImpactService, type ImpactQueryRequest } from './impact.service';

@Controller()
export class ImpactController {
  constructor(
    private readonly impactService: ImpactService,
    private readonly graph: GraphRepository,
  ) {}

  @Post('impact-queries')
  @HttpCode(201)
  runQuery(@Body() body: ImpactQueryRequest) {
    return this.impactService.runQuery(body);
  }

  @Get('versions')
  listVersions(): { readonly versions: readonly LawVersion[] } {
    return { versions: this.graph.loadGraph().versions };
  }
}
