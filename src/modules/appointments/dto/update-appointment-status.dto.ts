import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';

/**
 * Teto do motivo de cancelamento. A coluna é `text` (sem limite no Postgres),
 * então sem isto o campo aceitava qualquer tamanho — 10.001 caracteres eram
 * gravados inteiros. É uma justificativa curta ("paciente desmarcou", "médico
 * em cirurgia"), não um prontuário.
 */
export const CANCELLATION_REASON_MAX_LENGTH = 500;

export class UpdateAppointmentStatusDto {
  @IsEnum(AppointmentStatus)
  @IsNotEmpty()
  status: AppointmentStatus;

  /** Motivo — usado ao cancelar. */
  @IsOptional()
  @IsString()
  @MaxLength(CANCELLATION_REASON_MAX_LENGTH, {
    message: `O motivo do cancelamento deve ter no máximo ${CANCELLATION_REASON_MAX_LENGTH} caracteres.`,
  })
  cancellationReason?: string;
}
