import { IsString, IsNotEmpty } from 'class-validator';

import * as dayjs from 'dayjs';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsDateString, IsNumber } from 'class-validator';
export class ScheduleSurgeryRequestDto {
  @IsString()
  @IsNotEmpty()
  id: string;
  @IsDate()
  @Transform(({ value }) => dayjs(value).toDate())
  selected_date: Date;
}
