import { IsNumber, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { PAGINATION_DEFAULTS } from 'src/shared/constants/pagination';

export class FindManySharedDto {
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value ? +value : PAGINATION_DEFAULTS.SKIP))
  skip?: number;

  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value ? +value : PAGINATION_DEFAULTS.TAKE))
  take?: number;
}
