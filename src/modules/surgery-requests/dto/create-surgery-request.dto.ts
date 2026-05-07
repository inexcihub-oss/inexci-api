import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { stripObjectPhoneMask } from 'src/shared/pipes/phone-mask.pipe';
import { SurgeryRequestPriority } from 'src/database/entities/surgery-request.entity';

export class PatientInputDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class HealthPlanInputDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class HospitalInputDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class CreateSurgeryRequestDto {
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  is_indication: boolean;

  @ValidateIf((o) => o.is_indication)
  @IsString()
  @IsNotEmpty()
  indication_name: string;

  @IsOptional()
  @IsString()
  procedure_id?: string;

  @ValidateNested()
  @Type(() => PatientInputDto)
  @Transform(({ value }) => stripObjectPhoneMask(value))
  patient: PatientInputDto;

  @ValidateNested()
  @Type(() => HealthPlanInputDto)
  @Transform(({ value }) => stripObjectPhoneMask(value))
  health_plan: HealthPlanInputDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => HospitalInputDto)
  @Transform(({ value }) => stripObjectPhoneMask(value))
  hospital?: HospitalInputDto;

  @IsOptional()
  @IsEnum(SurgeryRequestPriority)
  priority?: SurgeryRequestPriority;
}
