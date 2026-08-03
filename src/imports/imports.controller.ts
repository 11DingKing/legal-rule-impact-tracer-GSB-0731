import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ImportsService, type ImportResult } from './imports.service';

/**
 * Thin HTTP boundary for imports. It delegates all parsing and persistence to
 * the service and only adjusts the status code (200 for a deduplicated import,
 * 201 for a new one). No graph logic lives here.
 */
@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post()
  @HttpCode(201)
  importDocument(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): ImportResult {
    const result = this.importsService.importDocument(body);
    if (result.deduplicated) {
      response.status(200);
    }
    return result;
  }
}
