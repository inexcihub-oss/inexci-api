import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { AppointmentType } from 'src/database/entities/appointment.entity';

export class CreateAppointmentDto {
  @IsUUID()
  @IsNotEmpty()
  patientId: string;

  @IsUUID()
  @IsNotEmpty()
  doctorId: string;

  /** Local de atendimento (opcional). */
  @IsOptional()
  @IsUUID()
  clinicId?: string;

  /** Sala da clínica (precisa ser da clínica da consulta). `null` tira a sala. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  roomId?: string | null;

  /** Encaixe: não passa pela checagem de conflito de horário. */
  @IsOptional()
  @IsBoolean()
  isWalkIn?: boolean;

  /** Convênio da consulta. `null` = particular. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  healthPlanId?: string | null;

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
