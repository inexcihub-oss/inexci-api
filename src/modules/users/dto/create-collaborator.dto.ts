import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { PhoneTransform } from 'src/shared/pipes/phone-mask.pipe';
import { Permission } from 'src/shared/permissions';

export class CreateCollaboratorDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Telefone é obrigatório' })
  @PhoneTransform()
  phone: string;

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

  /**
   * Áreas concedidas ao colaborador. Omitido = nasce sem nenhuma; `role` não
   * é aceito por este DTO — permanece indeterminável pelo corpo da
   * requisição (só `assertPodeGerirEquipe` decide quem pode chamar a rota).
   *
   * `@ValidateIf` (não `@IsOptional`) pelo mesmo motivo do
   * `UpdateCollaboratorDto`: `null` explícito deve virar 400 na validação,
   * não ser aceito silenciosamente.
   */
  @IsArray()
  @IsEnum(Permission, { each: true })
  @ValidateIf((o) => o.permissions !== undefined)
  permissions?: Permission[];
}
