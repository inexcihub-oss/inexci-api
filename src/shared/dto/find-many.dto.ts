import { IsNumber, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class FindManySharedDto {
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value ? +value : 0))
  skip?: number;

  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value ? +value : 10))
  take?: number;
}
