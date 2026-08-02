import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { GraphRepository } from '../persistence/graph.repository';
import { ImpactService, type ImpactQueryResponse } from './impact.service';
import type { LawVersion } from '../domain/types';

/**
 * HTTP boundary for impact queries and version listing. It forwards the body
 * to the service and returns the frozen snapshot response. No propagation
 * logic lives here.
 */
@Controller()
export class ImpactController {
  constructor(
    private readonly impactService: ImpactService,
    private readonly graph: GraphRepository,
  ) {}

  @Post('impact-queries')
  @HttpCode(201)
  runQuery(
    @Body()
    body: {
      readonly fromVersion?: unknown;
      readonly toVersion?: unknown;
      readonly asOf?: unknown;
    },
  ): ImpactQueryResponse {
    return this.impactService.runQuery(body);
  }

  @Get('versions')
  listVersions(): { readonly versions: readonly LawVersion[] } {
    return { versions: this.graph.loadGraph().versions };
  }
}
