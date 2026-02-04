import { IsString, IsNotEmpty } from 'class-validator';

import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';
export class FindOneSurgeryRequestDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}
