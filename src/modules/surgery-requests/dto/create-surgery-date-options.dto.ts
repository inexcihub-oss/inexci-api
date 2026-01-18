import { Type } from 'class-transformer';
import { IsArray, IsNumber, Min, MinLength } from 'class-validator';

export class CreateSurgeryDateOptions {
  @IsNumber()
  @Type(() => Number)
  id: number;

  @IsArray()
  dates: string[];
}
