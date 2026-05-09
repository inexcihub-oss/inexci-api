import { IsOptional, IsString } from 'class-validator';

export class UpdateDoctorProfileDto {
  @IsString()
  @IsOptional()
  crm?: string;

  @IsString()
  @IsOptional()
  crmState?: string;

  @IsString()
  @IsOptional()
  specialty?: string;

  @IsString()
  @IsOptional()
  signature_image_url?: string | null;
}
