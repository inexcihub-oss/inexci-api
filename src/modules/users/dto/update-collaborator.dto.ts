import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { UserPhone } from 'src/shared/pipes/phone-mask.pipe';
import { Permission } from 'src/shared/permissions';
import { ProfessionalCouncil } from 'src/database/entities/doctor-profile.entity';
import { NormalizeEmail } from 'src/shared/validators/normalize-email.decorator';

export class UpdateCollaboratorDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  @IsEmail()
  @NormalizeEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @UserPhone()
  phone?: string;

  @IsBoolean()
  @IsOptional()
  isDoctor?: boolean;

  @IsOptional()
  @IsEnum(ProfessionalCouncil)
  council?: ProfessionalCouncil;

  @IsOptional()
  @IsString()
  crm?: string;

  @IsOptional()
  @IsString()
  crmState?: string;

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
  addressNumber?: string;

  @IsString()
  @IsOptional()
  addressComplement?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsArray()
  @IsEnum(Permission, { each: true })
  @ValidateIf((o) => o.permissions !== undefined)
  permissions?: Permission[];
}
