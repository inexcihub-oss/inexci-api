import { IsString, IsNotEmpty } from 'class-validator';

import { Type } from 'class-transformer';
import { IsArray, IsNumber, Min, MinLength } from 'class-validator';
export class CreateSurgeryDateOptions {
  @IsString()
  @IsNotEmpty()
  id: string;
  @IsArray()
  dates: string[];
}
