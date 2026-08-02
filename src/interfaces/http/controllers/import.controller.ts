import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ImportService } from '../../../application/services/import.service';
import { ImportGraphDto } from '../../../application/dto/import-graph.dto';

@Controller('api/v1/import')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  importGraph(@Body() dto: ImportGraphDto) {
    return this.importService.import(dto);
  }
}
