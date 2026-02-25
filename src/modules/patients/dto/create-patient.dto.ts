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
  email: string;
  @IsOptional() @IsString() cpf?: string;

  @IsOptional()
  @IsIn(['M', 'F', 'm', 'f'])
  gender?: string;

  @IsOptional()
  @IsDateString()
  birth_date?: string;

  @IsOptional() @IsString() health_plan_id?: string;
  @IsOptional() @IsString() health_plan_number?: string;
  @IsOptional() @IsString() health_plan_type?: string;
  @IsOptional() @IsString() zip_code?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() address_number?: string;
  @IsOptional() @IsString() address_complement?: string;
  @IsOptional() @IsString() neighborhood?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() medical_notes?: string;
}
