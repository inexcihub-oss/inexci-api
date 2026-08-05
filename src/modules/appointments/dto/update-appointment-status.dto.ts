import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';

export class UpdateAppointmentStatusDto {
  @IsEnum(AppointmentStatus)
  @IsNotEmpty()
  status: AppointmentStatus;

  /** Motivo — usado ao cancelar. */
  @IsOptional()
  @IsString()
  cancellationReason?: string;
}
