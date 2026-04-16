import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { PhoneTransform } from 'src/shared/pipes/phone-mask.pipe';

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
  @PhoneTransform()
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

  @IsString()
  @IsOptional()
  cep?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  address_number?: string;

  @IsString()
  @IsOptional()
  address_complement?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;
}
