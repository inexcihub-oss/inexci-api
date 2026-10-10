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

  @IsOptional()
  @IsEnum(ProfessionalCouncil)
  council?: ProfessionalCouncil;

  @ValidateIf((o) => exigeRegistroCrm(o) || informado(o.crm))
  @IsString()
  @IsNotEmpty({ message: 'CRM é obrigatório para médicos' })
  crm?: string;

  @ValidateIf((o) => exigeRegistroCrm(o) || informado(o.crmState))
  @IsString()
  @IsNotEmpty({ message: 'Estado do CRM é obrigatório para médicos' })
  crmState?: string;

  @IsString()
  @IsOptional()
  specialty?: string;

  @IsArray()
  @IsEnum(Permission, { each: true })
  @ValidateIf((o) => o.permissions !== undefined)
  permissions?: Permission[];
}
