import * as dayjs from 'dayjs';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateQuotationDto {
  @IsString()
  @IsNotEmpty()
  surgery_request_quotation_id: string;

  @IsOptional()
  @IsString()
  proposal_number?: string;

  @IsOptional()
  @Transform(({ value }) => dayjs(value, 'DD/MM/YYYY').toDate())
  @IsDate()
  submission_date?: string;
}
