import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  IsBoolean,
  IsOptional,
  ValidateIf,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;

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

  @IsString()
  @IsOptional()
  subscription_plan_id?: string;
}
