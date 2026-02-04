import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';
import { SurgeryRequestPriority } from '../../../database/entities';

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
  health_plan_id?: string;

  @IsOptional()
  @IsString()
  hospital_id?: string;

  @IsNumber()
  priority: SurgeryRequestPriority;
}
