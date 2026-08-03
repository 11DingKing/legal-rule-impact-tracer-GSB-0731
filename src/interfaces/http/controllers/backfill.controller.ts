import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { BackfillService } from '../../../application/services/backfill.service';
import { BackfillDto } from '../../../application/dto/backfill.dto';

@Controller('api/v1/backfill')
export class BackfillController {
  constructor(private readonly backfillService: BackfillService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  backfill(@Body() dto: BackfillDto) {
    return this.backfillService.backfill(dto);
  }
}
