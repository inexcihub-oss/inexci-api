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
import { ProfessionalCouncil } from 'src/database/entities/doctor-profile.entity';

const informado = (v: unknown) => v !== undefined && v !== null && v !== '';

/** CRM é o default: sem `council`, o perfil continua sendo de médico. */
const exigeRegistroCrm = (o: CreateCollaboratorDto) =>
  o.isDoctor === true &&
  (o.council ?? ProfessionalCouncil.CRM) === ProfessionalCouncil.CRM;

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

  /**
   * Conselho do profissional. Omitido = CRM (médico). Psicologia, nutrição,
   * enfermagem etc. têm agenda e prontuário, mas não emitem receita nem
   * indicam cirurgia.
   */
  @IsOptional()
  @IsEnum(ProfessionalCouncil)
  council?: ProfessionalCouncil;

  /** Número no conselho. Obrigatório só para CRM. */
  @ValidateIf((o) => exigeRegistroCrm(o) || informado(o.crm))
  @IsString()
  @IsNotEmpty({ message: 'CRM é obrigatório para médicos' })
  crm?: string;

  /** UF do conselho. Obrigatória só para CRM. */
  @ValidateIf((o) => exigeRegistroCrm(o) || informado(o.crmState))
  @IsString()
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
