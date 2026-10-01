import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ProfessionalCouncil } from 'src/database/entities/doctor-profile.entity';

export class UpdateDoctorProfileDto {
  /**
   * Conselho profissional. Só quem tem Administração na conta altera — o
   * próprio profissional não se promove a médico (CRM).
   */
  @IsEnum(ProfessionalCouncil)
  @IsOptional()
  council?: ProfessionalCouncil;

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
  signatureImageUrl?: string | null;
}
