import { IsString, IsNotEmpty } from 'class-validator';

import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';
export class ToInvoiceDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}
