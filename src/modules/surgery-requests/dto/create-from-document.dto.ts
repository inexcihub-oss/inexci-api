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
  @IsString()
  @IsNotEmpty()
  doctorId: string;

  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewPatientFromDocumentDto)
  newPatient?: NewPatientFromDocumentDto;

  @IsOptional()
  @IsString()
  procedureId?: string;

  @IsOptional()
  @IsString()
  procedureName?: string;

  @IsOptional()
  @IsString()
  hospitalId?: string;

  @IsOptional()
  @IsString()
  hospitalName?: string;

  @IsOptional()
  @IsString()
  healthPlanId?: string;

  @IsOptional()
  @IsString()
  healthPlanName?: string;

  @IsOptional()
  @IsString()
  healthPlanNumber?: string;

  @IsOptional()
  @IsEnum(SurgeryRequestPriority)
  priority?: SurgeryRequestPriority;

  @IsOptional()
  @IsString()
  notes?: string;

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  suggestedSuppliers?: string[];

  @IsOptional()
  @IsString()
  tempStoragePath?: string;

  @IsOptional()
  @IsString()
  originalFileName?: string;
}
