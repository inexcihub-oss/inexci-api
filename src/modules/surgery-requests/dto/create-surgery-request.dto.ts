import { Mask } from '@tboerc/maskfy';
import { Transform, Type } from 'class-transformer';
import {
  Allow,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsString,
  ValidateIf,
} from 'class-validator';

export class CreateSurgeryRequestDto {
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  is_indication: boolean;

  @ValidateIf((o) => o.is_indication)
  @IsString()
  @IsNotEmpty()
  indication_name: string;

  @Allow()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  procedure_id?: number;

  @Allow()
  @Transform(({ value }) => {
    value.phone = Mask.phone.raw(value.phone);

    return value;
  })
  patient: {
    name: string;
    email: string;
    phone: string;
  };

  @Allow()
  @Transform(({ value }) => {
    value.phone = Mask.phone.raw(value.phone);

    return value;
  })
  collaborator: {
    status: number;
    name: string;
    email: string;
    phone: string;
    password: string;
  };

  @Allow()
  @Transform(({ value }) => {
    value.phone = Mask.phone.raw(value.phone);

    return value;
  })
  health_plan: {
    name: string;
    email: string;
    phone: string;
  };

  @Allow()
  priority?: string;

  @Allow()
  deadline?: Date;
}
