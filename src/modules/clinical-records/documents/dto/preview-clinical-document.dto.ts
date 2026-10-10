import { Type } from 'class-transformer';
import { IntersectionType, OmitType } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { CidCodeDto } from '../../dto/cid-code.dto';
import { CreatePrescriptionDto } from './create-prescription.dto';
import { CreateMedicalCertificateDto } from './create-medical-certificate.dto';
import { CreateExamReferralDto } from './create-exam-referral.dto';

class PreviewTargetDto {
  @IsUUID()
  @IsOptional()
  clinicalRecordId?: string;

  @IsUUID()
  @IsOptional()
  patientId?: string;

  @IsUUID()
  @IsOptional()
  doctorId?: string;
}

export class PreviewPrescriptionDto extends IntersectionType(
  OmitType(CreatePrescriptionDto, ['clinicalRecordId'] as const),
  PreviewTargetDto,
) {}

export class PreviewMedicalCertificateDto extends IntersectionType(
  OmitType(CreateMedicalCertificateDto, ['clinicalRecordId'] as const),
  PreviewTargetDto,
) {
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CidCodeDto)
  cidCodes?: CidCodeDto[];
}

export class PreviewExamReferralDto extends IntersectionType(
  OmitType(CreateExamReferralDto, ['clinicalRecordId'] as const),
  PreviewTargetDto,
) {}
