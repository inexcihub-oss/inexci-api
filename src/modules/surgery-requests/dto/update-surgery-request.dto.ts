import { Transform, Type } from 'class-transformer';
import { stripObjectPhoneMask } from 'src/shared/pipes/phone-mask.pipe';
import {
  Allow,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateSurgeryRequestHealthPlanDto {
  @Allow()
  id: string;
  @Allow()
  name: string;
  @Allow()
  email: string;
  @Allow()
  phone: string;
}

export class UpdateSurgeryRequestCidDto {
  @Allow()
  id: string;
  @Allow()
  description: string;
}

export class UpdateSurgeryRequestHospitalDto {
  @Allow()
  name: string;
  @Allow()
  email: string;
}

export class UpdateSurgeryRequestDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsOptional()
  @Transform(({ value }) => stripObjectPhoneMask(value))
  @Type(() => UpdateSurgeryRequestHealthPlanDto)
  healthPlan?: UpdateSurgeryRequestHealthPlanDto;

  @IsOptional()
  @IsString()
  healthPlanRegistration?: string;

  @IsOptional()
  @IsString()
  healthPlanType?: string;

  @IsOptional()
  @Allow()
  @Type(() => UpdateSurgeryRequestCidDto)
  cid?: UpdateSurgeryRequestCidDto;

  @IsOptional()
  @IsString()
  diagnosis?: string;

  @IsOptional()
  @IsString()
  medicalReport?: string;

  @IsOptional()
  @IsString()
  patientHistory?: string;

  @IsOptional()
  @Allow()
  @Type(() => UpdateSurgeryRequestHospitalDto)
  hospital?: UpdateSurgeryRequestHospitalDto;

  @IsOptional()
  @IsNumber()
  priority?: number;
}
