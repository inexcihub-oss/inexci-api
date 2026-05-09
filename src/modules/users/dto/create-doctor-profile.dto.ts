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
  crmState: string;

  @IsOptional() @IsString() clinicName?: string;
  @IsOptional() @IsString() clinicCnpj?: string;
  @IsOptional() @IsString() clinicAddress?: string;
}
