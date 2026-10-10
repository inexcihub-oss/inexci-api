import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';

export const CANCELLATION_REASON_MAX_LENGTH = 500;

export class UpdateAppointmentStatusDto {
  @IsEnum(AppointmentStatus)
  @IsNotEmpty()
  status: AppointmentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(CANCELLATION_REASON_MAX_LENGTH, {
    message: `O motivo do cancelamento deve ter no máximo ${CANCELLATION_REASON_MAX_LENGTH} caracteres.`,
  })
  cancellationReason?: string;
}
