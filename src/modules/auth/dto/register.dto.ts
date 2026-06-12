import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  IsBoolean,
  IsOptional,
  Matches,
  ValidateIf,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { IsStrongPassword } from 'src/shared/validators/strong-password.decorator';

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
  @Matches(/^\D*(?:\d\D*){10,11}$/, {
    message: 'Informe um telefone válido com DDD (10 ou 11 dígitos)',
  })
  phone: string;

  /**
   * Slug do plano de assinatura escolhido no cadastro. Opcional — quando
   * omitido, o backend usa o plano marcado como `is_trial_default`.
   *
   * Planos com `isTrialDefault=true` criam uma assinatura de 30 dias grátis.
   * Planos pagos (essencial, profissional, enterprise) exigem `paymentMethodId`.
   */
  @IsString()
  @IsOptional()
  planSlug?: string;

  @IsString()
  @IsOptional()
  paymentMethodId?: string;

  @IsString()
  @IsOptional()
  cardBrand?: string;

  @IsString()
  @IsOptional()
  cardLast4?: string;

  @IsString()
  @IsOptional()
  cardHolderName?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(12)
  cardExpMonth?: number;

  @IsInt()
  @IsOptional()
  cardExpYear?: number;
}
