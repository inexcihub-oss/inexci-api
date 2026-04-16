import { Transform, Type } from 'class-transformer';
import { stripObjectPhoneMask } from 'src/shared/pipes/phone-mask.pipe';
import {
  Allow,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateSurgeryRequestDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsOptional()
  @Transform(({ value }) => stripObjectPhoneMask(value))
  health_plan?: {
    id: string;
    name: string;
    email: string;
    phone: string;
  };

  @IsOptional()
  @IsString()
  health_plan_registration?: string;

  @IsOptional()
  @IsString()
  health_plan_type?: string;

  @IsOptional()
  @Allow()
  cid?: {
    id: string;
    description: string;
  };

  @IsOptional()
  @IsString()
  diagnosis?: string;

  @IsOptional()
  @IsString()
  medical_report?: string;

  @IsOptional()
  @IsString()
  patient_history?: string;

  @IsOptional()
  @Allow()
  hospital?: {
    name: string;
    email: string;
  };

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  deadline?: Date;
}
