import { Mask } from '@tboerc/maskfy';
import { Transform, Type } from 'class-transformer';
import {
  Allow,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateSurgeryRequestDto {
  @Type(() => Number)
  @IsNumber()
  id: number;

  @IsNotEmpty()
  @Transform(({ value }) => {
    value.phone = Mask.phone.raw(value.phone);

    return value;
  })
  health_plan: {
    id: number;
    name: string;
    email: string;
    phone: string;
  };

  @IsString()
  @IsNotEmpty()
  health_plan_registration: string;

  @IsString()
  @IsNotEmpty()
  health_plan_type: string;

  @IsOptional()
  @Allow()
  cid: {
    id: string;
    description: string;
  };

  @IsString()
  diagnosis: string;

  @IsString()
  medical_report: string;

  @IsString()
  patient_history: string;

  @Allow()
  hospital: {
    name: string;
    email: string;
  };

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  deadline?: Date;
}
