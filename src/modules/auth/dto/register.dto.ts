import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  IsBoolean,
  IsOptional,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { UserPhone } from 'src/shared/pipes/phone-mask.pipe';
import { IsStrongPassword } from 'src/shared/validators/strong-password.decorator';
import { NormalizeEmail } from 'src/shared/validators/normalize-email.decorator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @NormalizeEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @IsStrongPassword()
  password: string;

  @IsBoolean()
  @IsOptional()
  isDoctor?: boolean;

  @IsString()
  @ValidateIf((o) => o.isDoctor === true)
  @IsNotEmpty({ message: 'CRM é obrigatório para médicos' })
  crm?: string;

  @IsString()
  @ValidateIf((o) => o.isDoctor === true)
  @IsNotEmpty({ message: 'Estado do CRM é obrigatório para médicos' })
  crmState?: string;

  @IsString()
  @IsOptional()
  specialty?: string;

  @IsString()
  @IsNotEmpty({ message: 'O telefone é obrigatório' })
  @UserPhone()
  phone: string;

  @IsString()
  @IsOptional()
  planSlug?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  captchaToken?: string;
}
