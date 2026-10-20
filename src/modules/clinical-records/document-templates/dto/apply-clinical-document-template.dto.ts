import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ApplyClinicalDocumentTemplateDto {
  @IsUUID()
  @IsOptional()
  clinicalRecordId?: string;

  @IsUUID()
  @IsOptional()
  patientId?: string;

  @IsUUID()
  @IsOptional()
  doctorId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  restDays?: number;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsBoolean()
  @IsOptional()
  refresh?: boolean;
}
