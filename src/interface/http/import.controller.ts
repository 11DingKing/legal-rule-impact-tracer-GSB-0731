import { Body, Controller, Post } from '@nestjs/common';
import { ImportService } from '../../app/import.service';
import type { RevisionGraphInput } from '../../domain';
import { ImportRequestDto } from './dto';

@Controller('api/import')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post()
  import(@Body() body: ImportRequestDto) {
    const input: RevisionGraphInput = {
      versions: body.versions,
      articles: body.articles,
      succession: body.succession,
      bindings: body.bindings,
    };
    return this.importService.import(input);
  }
}
