import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';

export class ToInvoiceDto {
  @Type(() => Number)
  @IsNumber()
  id: number;
}
