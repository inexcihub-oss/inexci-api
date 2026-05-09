import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  IsBoolean,
  IsOptional,
  Matches,
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
   * Em qualquer caso, a assinatura inicial é criada como TRIALING (30 dias)
   * e não exige cartão.
   */
  @IsString()
  @IsOptional()
  planSlug?: string;
}
