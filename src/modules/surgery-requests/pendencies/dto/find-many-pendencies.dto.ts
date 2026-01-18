import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';

export class FindManyPendenciesDto {
  @Type(() => Number)
  @IsNumber()
  surgery_request_id: number;
}
