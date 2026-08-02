import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class VersionDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsIn(['DRAFT', 'PUBLISHED', 'EFFECTIVE'])
  status!: 'DRAFT' | 'PUBLISHED' | 'EFFECTIVE';

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'effectiveFrom must be YYYY-MM-DD or null',
  })
  effectiveFrom!: string | null;
}

export class ArticleDto {
  @IsString()
  @IsNotEmpty()
  stableId!: string;

  @IsString()
  @IsNotEmpty()
  version!: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  references?: string[];
}

export class SuccessionDto {
  @IsString()
  @IsNotEmpty()
  from!: string;

  @IsArray()
  @IsString({ each: true })
  to!: string[];

  @IsString()
  @IsIn(['SPLIT', 'MERGE', 'RENAME', 'REVISE'])
  kind!: 'SPLIT' | 'MERGE' | 'RENAME' | 'REVISE';
}

export class BindingDto {
  @IsString()
  @IsNotEmpty()
  ruleId!: string;

  @IsArray()
  @IsString({ each: true })
  articleIds!: string[];
}

export class ImportGraphDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VersionDto)
  versions!: VersionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ArticleDto)
  articles!: ArticleDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SuccessionDto)
  succession!: SuccessionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BindingDto)
  bindings!: BindingDto[];
}
