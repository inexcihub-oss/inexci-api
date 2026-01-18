import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';

export class FindOneSurgeryRequestDto {
  @Type(() => Number)
  @IsNumber()
  id: number;
}
