import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { SurgeryRequestPriority } from 'src/database/entities';

export class RequiredDocumentDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}

export class CreateSurgeryRequestSimpleDto {
  @IsString()
  @IsNotEmpty()
  procedureId: string;

  @IsString()
  @IsNotEmpty()
  patientId: string;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  healthPlanId?: string;

  @IsOptional()
  @IsString()
  hospitalId?: string;

  @Type(() => Number)
  @IsNumber()
  priority: SurgeryRequestPriority;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequiredDocumentDto)
  requiredDocuments?: RequiredDocumentDto[];
}
