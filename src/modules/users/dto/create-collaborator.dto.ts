import { Transform } from 'class-transformer';
import { Mask } from '@tboerc/maskfy';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class CreateCollaboratorDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? Mask.phone.raw(value) : value))
  phone?: string;

  @IsBoolean()
  @IsOptional()
  is_doctor?: boolean;

  @IsString()
  @ValidateIf((o) => o.is_doctor === true)
  @IsNotEmpty({ message: 'CRM é obrigatório para médicos' })
  crm?: string;

  @IsString()
  @ValidateIf((o) => o.is_doctor === true)
  @IsNotEmpty({ message: 'Estado do CRM é obrigatório para médicos' })
  crm_state?: string;

  @IsString()
  @IsOptional()
  specialty?: string;
}
