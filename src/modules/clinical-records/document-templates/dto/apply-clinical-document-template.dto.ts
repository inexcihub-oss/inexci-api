import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * Para quem o texto do modelo é montado. Igual à prévia: a ficha gravada ou,
 * sem ela, o paciente (e o médico que assina) que estão na tela.
 */
export class ApplyClinicalDocumentTemplateDto {
  @IsUUID()
  @IsOptional()
  clinicalRecordId?: string;

  @IsUUID()
  @IsOptional()
  patientId?: string;

  @IsUUID()
  @IsOptional()
  doctorId?: string;

  /** Preenche `{{dias}}` no atestado. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  restDays?: number;
}
