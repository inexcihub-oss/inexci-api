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
  procedure_id: string;

  @IsString()
  @IsNotEmpty()
  patient_id: string;

  @IsOptional()
  @IsString()
  doctor_id?: string;

  @IsOptional()
  @IsString()
  health_plan_id?: string;

  @IsOptional()
  @IsString()
  hospital_id?: string;

  @Type(() => Number)
  @IsNumber()
  priority: SurgeryRequestPriority;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequiredDocumentDto)
  required_documents?: RequiredDocumentDto[];
}
