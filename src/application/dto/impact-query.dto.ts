import { IsNotEmpty, IsString } from 'class-validator';

export class ImpactQueryDto {
  @IsString()
  @IsNotEmpty()
  sourceVersionId!: string;

  @IsString()
  @IsNotEmpty()
  targetVersionId!: string;
}
