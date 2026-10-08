import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

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

  /**
   * **Ignorado.** O texto aplicado sempre mantém `{{dias}}`/`{{inicio}}`
   * literais e a prévia/emissão os preenche com o afastamento final — senão o
   * texto editado congelava os dias antigos. Segue aceito porque a validação
   * global recusa campo desconhecido (`forbidNonWhitelisted`) e um bundle em
   * cache ainda o envia.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  restDays?: number;

  /** **Ignorado** — mesma razão de `restDays`. */
  @IsDateString()
  @IsOptional()
  startDate?: string;

  /**
   * Reaplicação do mesmo modelo sem nova escolha: não conta outro uso — quem
   * conta é a escolha do modelo.
   */
  @IsBoolean()
  @IsOptional()
  refresh?: boolean;
}
