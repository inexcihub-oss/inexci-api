import { Transform } from 'class-transformer';
import { Mask } from '@tboerc/maskfy';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class UpdateCollaboratorDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? Mask.phone.raw(value) : value))
  phone?: string;

  @IsBoolean()
  @IsOptional()
  is_doctor?: boolean;

  @IsString()
  @ValidateIf((o) => o.is_doctor === true)
  crm?: string;

  @IsString()
  @ValidateIf((o) => o.is_doctor === true)
  crm_state?: string;

  @IsString()
  @IsOptional()
  specialty?: string;
}
