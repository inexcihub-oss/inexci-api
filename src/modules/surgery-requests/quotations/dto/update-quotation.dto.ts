import * as dayjs from 'dayjs';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class UpdateQuotationDto {
  @Type(() => Number)
  @IsNumber()
  surgery_request_quotation_id: number;

  @IsString()
  @IsNotEmpty()
  proposal_number: string;

  @Transform(({ value }) => dayjs(value, 'DD/MM/YYYY').toDate())
  @IsDate()
  submission_date: string;
}
