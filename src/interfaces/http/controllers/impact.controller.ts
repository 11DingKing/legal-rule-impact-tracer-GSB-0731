import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ImpactQueryService } from '../../../application/services/impact-query.service';
import { ImpactQueryDto } from '../../../application/dto/impact-query.dto';

@Controller('api/v1/impact')
export class ImpactController {
  constructor(private readonly impactQueryService: ImpactQueryService) {}

  @Post('query')
  @HttpCode(HttpStatus.OK)
  queryImpact(@Body() dto: ImpactQueryDto) {
    return this.impactQueryService.query(
      dto.sourceVersionId,
      dto.targetVersionId,
    );
  }
}
