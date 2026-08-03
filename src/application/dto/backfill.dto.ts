import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class BackfillDto {
  @IsString()
  @IsNotEmpty()
  from!: string;

  @IsString()
  @IsNotEmpty()
  to!: string;

  @IsString()
  @IsIn(['SPLIT', 'MERGE', 'RENAME', 'REVISE'])
  kind!: 'SPLIT' | 'MERGE' | 'RENAME' | 'REVISE';
}
