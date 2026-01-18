import { Transform, Type } from 'class-transformer';
import { IsDate, IsNumber, IsString } from 'class-validator';
import * as dayjs from 'dayjs';

export class CreateComplaintDto {
  @Type(() => Number)
  @IsNumber()
  surgery_request_id: number;

  @Type(() => Date)
  @IsDate()
  date_call: Date;

  @IsString()
  protocol: string;
}
