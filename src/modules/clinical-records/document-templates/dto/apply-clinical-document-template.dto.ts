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
   * Preenche `{{dias}}` no atestado. Ausente, o placeholder fica literal no
   * texto e a emissão o preenche com os dias do próprio atestado.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  restDays?: number;

  /**
   * Início do afastamento (ISO), para `{{inicio}}`. Mesma regra de `restDays`:
   * ausente, fica literal para a emissão preencher.
   */
  @IsDateString()
  @IsOptional()
  startDate?: string;

  /**
   * Reaplicação do mesmo modelo só para atualizar o texto na tela (ex.: os
   * dias de afastamento mudaram). Não conta outro uso — quem conta é a
   * escolha do modelo. A emissão não depende disto: ela manda o `templateId`
   * e o servidor preenche `{{dias}}` com os dias do próprio atestado.
   */
  @IsBoolean()
  @IsOptional()
  refresh?: boolean;
}
