import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import {
  SIGNATURE_PATH_MESSAGE,
  SIGNATURE_PATH_REGEX,
} from './update-profile.dto';
import { ProfessionalCouncil } from 'src/database/entities/doctor-profile.entity';

export class UpdateDoctorProfileDto {
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

  @IsOptional()
  @Transform(({ value }) => value ?? null)
  @IsString()
  @Matches(SIGNATURE_PATH_REGEX, { message: SIGNATURE_PATH_MESSAGE })
  signatureImageUrl?: string | null;
}
