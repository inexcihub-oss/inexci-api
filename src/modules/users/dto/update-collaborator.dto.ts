import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { PhoneTransform } from 'src/shared/pipes/phone-mask.pipe';
import { Permission } from 'src/shared/permissions';
import { ProfessionalCouncil } from 'src/database/entities/doctor-profile.entity';

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
  isDoctor?: boolean;

  @IsOptional()
  @IsEnum(ProfessionalCouncil)
  council?: ProfessionalCouncil;

  /**
   * Número/UF no conselho. Opcionais aqui: quem valida é o
   * `UsersService.updateCollaborator`, sobre o estado FINAL do perfil (o que
   * já está gravado + o que veio no corpo) — CRM exige os dois, os demais
   * conselhos não.
   */
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

  /**
   * Áreas concedidas ao colaborador. `undefined` = não mexer no que já está
   * gravado; `[]` = retirar todas. `role` não é aceito por este DTO.
   *
   * `@ValidateIf` (não `@IsOptional`) de propósito: `IsOptional` também
   * pula a validação para `null`, e o service trata `null` como "mexeu"
   * (`!== undefined`) — um `permissions: null` explícito no corpo iria
   * direto para a coluna `text[] NOT NULL` e estouraria a constraint do
   * banco (500). Com `ValidateIf`, só `undefined` pula a validação; `null`
   * cai em `@IsArray()` e vira 400 pela `ValidationPipe` global.
   */
  @IsArray()
  @IsEnum(Permission, { each: true })
  @ValidateIf((o) => o.permissions !== undefined)
  permissions?: Permission[];
}
