import * as dayjs from 'dayjs';
import { Mask } from '@tboerc/maskfy';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsNumber } from 'class-validator';

export class ReceiveDto {
  @Type(() => Number)
  @IsNumber()
  surgery_request_id: number;

  @IsNumber()
  @Transform(({ value }) => Mask.money.raw(value))
  received_value: string;

  @IsDate()
  @Transform(({ value }) => dayjs(value).toDate())
  received_date: Date;
}
