import * as dayjs from 'dayjs';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsDateString, IsNumber } from 'class-validator';

export class ScheduleSurgeryRequestDto {
  @IsNumber()
  @Type(() => Number)
  id: number;

  @IsDate()
  @Transform(({ value }) => dayjs(value).toDate())
  selected_date: Date;
}
