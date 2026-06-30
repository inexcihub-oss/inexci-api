import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsNotEmpty,
  IsNumberString,
  IsIn,
  IsDateString,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SurgeryRequestPriority } from 'src/database/entities/surgery-request.entity';

export class NewPatientFromDocumentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsNumberString()
  cpf: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsIn(['M', 'F'])
  gender?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  addressNumber?: string;

  @IsOptional()
  @IsString()
  addressComplement?: string;

  @IsOptional()
  @IsString()
  neighborhood?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  zipCode?: string;

  /** Número da carteirinha do convênio. */
  @IsOptional()
  @IsString()
  healthPlanNumber?: string;
}

export class TussItemFromDocumentDto {
  @IsString()
  @IsNotEmpty()
  tussCode: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;
}

export class OpmeItemFromDocumentDto {
  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @Min(1)
  qty: number;

  @IsOptional()
  @IsString()
  supplier?: string;

  @IsOptional()
  @IsString()
  manufacturer?: string;
}

export class ReportSectionFromDocumentDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateFromDocumentDto {
  /** ID do médico responsável (obrigatório). */
  @IsString()
  @IsNotEmpty()
  doctorId: string;

  /** Paciente existente — exclusivo com `newPatient`. */
  @IsOptional()
  @IsString()
  patientId?: string;

  /** Novo paciente a cadastrar — exclusivo com `patientId`. */
  @IsOptional()
  @ValidateNested()
  @Type(() => NewPatientFromDocumentDto)
  newPatient?: NewPatientFromDocumentDto;

  @IsOptional()
  @IsString()
  procedureId?: string;

  /** Nome do procedimento extraído/ajustado (usado quando não há `procedureId`). */
  @IsOptional()
  @IsString()
  procedureName?: string;

  @IsOptional()
  @IsString()
  hospitalId?: string;

  /** Nome do hospital extraído (usado quando não há `hospitalId`). */
  @IsOptional()
  @IsString()
  hospitalName?: string;

  @IsOptional()
  @IsString()
  healthPlanId?: string;

  /** Nome do convênio extraído (usado quando não há `healthPlanId`). */
  @IsOptional()
  @IsString()
  healthPlanName?: string;

  /** Número da carteirinha para backfill no paciente existente. */
  @IsOptional()
  @IsString()
  healthPlanNumber?: string;

  @IsOptional()
  @IsEnum(SurgeryRequestPriority)
  priority?: SurgeryRequestPriority;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Seções estruturadas do laudo (título + descrição) — tem prioridade sobre `notes`. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportSectionFromDocumentDto)
  sections?: ReportSectionFromDocumentDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TussItemFromDocumentDto)
  tussItems?: TussItemFromDocumentDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpmeItemFromDocumentDto)
  opmeItems?: OpmeItemFromDocumentDto[];

  /** Caminho no storage retornado pelo endpoint de extração. */
  @IsOptional()
  @IsString()
  tempStoragePath?: string;

  /** Nome original do arquivo (para exibição no documento anexado). */
  @IsOptional()
  @IsString()
  originalFileName?: string;
}
