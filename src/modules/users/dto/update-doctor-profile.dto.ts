import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import {
  SIGNATURE_PATH_MESSAGE,
  SIGNATURE_PATH_REGEX,
} from './update-profile.dto';
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

  /**
   * Caminho devolvido pelo `POST /upload/single` (pasta `signatures`/`stamps`);
   * `null` remove. Mesma regra do `UpdateProfileDto.signatureUrl`; o service
   * ainda exige que o caminho seja da pasta da conta do profissional-alvo.
   */
  @IsOptional()
  @Transform(({ value }) => value ?? null)
  @IsString()
  @Matches(SIGNATURE_PATH_REGEX, { message: SIGNATURE_PATH_MESSAGE })
  signatureImageUrl?: string | null;
}
