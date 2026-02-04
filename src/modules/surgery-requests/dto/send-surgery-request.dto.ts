import { IsString, IsNotEmpty } from 'class-validator';

import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';
export class SendSurgeryRequestDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}
