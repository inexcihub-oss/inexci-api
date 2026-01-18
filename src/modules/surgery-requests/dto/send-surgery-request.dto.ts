import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';

export class SendSurgeryRequestDto {
  @IsNumber()
  @Type(() => Number)
  id: number;
}
