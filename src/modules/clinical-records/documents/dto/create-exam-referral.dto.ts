import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CidCodeDto } from '../../dto/cid-code.dto';
import { CLINICAL_DOCUMENT_TEXT_MAX } from './create-medical-certificate.dto';

export class ExamReferralItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  tussCode?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  observation?: string;
}

export class CreateExamReferralDto {
  @IsUUID()
  @IsNotEmpty()
  clinicalRecordId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ExamReferralItemDto)
  exams: ExamReferralItemDto[];

  @IsString()
  @IsOptional()
  @MaxLength(CLINICAL_DOCUMENT_TEXT_MAX)
  clinicalIndication?: string;

  @IsUUID()
  @IsOptional()
  templateId?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CidCodeDto)
  cidCodes?: CidCodeDto[];
}
