import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CidCodeDto } from '../../dto/cid-code.dto';

export const CLINICAL_DOCUMENT_TEXT_MAX = 4000;

export class CreateMedicalCertificateDto {
  @IsUUID()
  @IsNotEmpty()
  clinicalRecordId: string;

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
  includeCid?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => CidCodeDto)
  cid?: CidCodeDto;

  @IsString()
  @IsOptional()
  @MaxLength(CLINICAL_DOCUMENT_TEXT_MAX)
  text?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  observations?: string;

  @IsUUID()
  @IsOptional()
  templateId?: string;
}
