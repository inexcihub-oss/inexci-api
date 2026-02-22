import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDoctorProfileDto {
  @IsString()
  @IsNotEmpty()
  specialty: string;

  @IsString()
  @IsNotEmpty()
  crm: string;

  @IsString()
  @IsNotEmpty()
  crm_state: string;

  @IsOptional() @IsString() clinic_name?: string;
  @IsOptional() @IsString() clinic_cnpj?: string;
  @IsOptional() @IsString() clinic_address?: string;
}
