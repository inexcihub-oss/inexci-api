import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { AppointmentType } from 'src/database/entities/appointment.entity';

/** Atualiza dados/horário da consulta (reagendamento). Não muda status. */
export class UpdateAppointmentDto {
  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  /** `null` desvincula a consulta da clínica. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  clinicId?: string | null;

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
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
