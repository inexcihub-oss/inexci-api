import { IsString, IsNotEmpty } from 'class-validator';

import * as dayjs from 'dayjs';
import { Mask } from '@tboerc/maskfy';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsNumber } from 'class-validator';
export class InvoiceDto {
  @IsString()
  @IsNotEmpty()
  surgery_request_id: string;
  @IsNumber()
  @Transform(({ value }) => Mask.money.raw(value))
  invoiced_value: string;
  @IsDate()
  @Transform(({ value }) => dayjs(value).toDate())
  invoiced_date: Date;
}
