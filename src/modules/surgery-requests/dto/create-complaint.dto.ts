import { Transform, Type } from 'class-transformer';
import { IsDate, IsNumber, IsString, IsNotEmpty } from 'class-validator';
import * as dayjs from 'dayjs';

export class CreateComplaintDto {
  @IsString()
  @IsNotEmpty()
  surgery_request_id: string;
  @Type(() => Date)
  @IsDate()
  date_call: Date;
  protocol: string;
}
