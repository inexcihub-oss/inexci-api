import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { AppointmentType } from 'src/database/entities/appointment.entity';

export class CreateAppointmentDto {
  @IsUUID()
  @IsNotEmpty()
  patientId: string;

  @IsUUID()
  @IsNotEmpty()
  doctorId: string;

  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  /** Início da consulta (ISO 8601 com data e hora). */
  @IsDateString()
  @IsNotEmpty()
  scheduledAt: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
