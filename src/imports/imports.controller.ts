import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ImportsService } from './imports.service';

@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post()
  @HttpCode(201)
  importDocument(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = this.importsService.importDocument(body);
    if (result.deduplicated) {
      response.status(200);
    }
    return result;
  }
}
