import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreatePatientDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  cpf: string;

  @IsIn(['M', 'F', 'm', 'f'])
  gender: string;

  @IsDateString()
  birth_date: string;

  @IsString()
  @IsNotEmpty()
  health_plan_id: string;

  @IsString()
  @IsNotEmpty()
  health_plan_number: string;

  @IsString()
  @IsNotEmpty()
  health_plan_type: string;

  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() zip_code?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() address_number?: string;
  @IsOptional() @IsString() address_complement?: string;
  @IsOptional() @IsString() neighborhood?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() medical_notes?: string;
}
