import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsArray,
} from 'class-validator';
import { SurgeryRequestPriority } from 'src/database/entities';

export class CreateSurgeryRequestSimpleDto {
  @IsString()
  @IsNotEmpty()
  procedure_id: string;

  @IsString()
  @IsNotEmpty()
  patient_id: string;

  @IsString()
  @IsNotEmpty()
  manager_id: string;

  @IsOptional()
  @IsString()
  doctor_id?: string;

  @IsOptional()
  @IsString()
  health_plan_id?: string;

  @IsOptional()
  @IsString()
  hospital_id?: string;

  @IsNumber()
  priority: SurgeryRequestPriority;

  @IsOptional()
  @IsArray()
  required_documents?: Array<{ type: string; name: string }>;
}
