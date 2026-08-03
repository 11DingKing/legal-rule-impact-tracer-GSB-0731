import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class ImpactQueryDto {
  @IsString()
  @IsNotEmpty()
  sourceVersionId!: string;

  @IsString()
  @IsNotEmpty()
  targetVersionId!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/, {
    message: 'asOf must be an ISO-8601 date or datetime',
  })
  asOf?: string;
}
