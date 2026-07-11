import { IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PAGINATION_DEFAULTS } from 'src/shared/constants/pagination';

export class FindManySharedDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  skip?: number = PAGINATION_DEFAULTS.SKIP;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  take?: number = PAGINATION_DEFAULTS.TAKE;
}
