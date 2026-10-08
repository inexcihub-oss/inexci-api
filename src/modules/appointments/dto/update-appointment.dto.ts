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

/**
 * Campo opcional que **não aceita `null`**: ausente passa, `null` cai nos
 * validadores do campo (e é recusado), em vez de virar `NULL` numa coluna
 * obrigatória. `@IsOptional` deixaria o `null` passar. Mesmo padrão dos DTOs
 * de disponibilidade.
 */
const SeInformado = () => ValidateIf((_, v: unknown) => v !== undefined);

/** Atualiza dados/horário da consulta (reagendamento). Não muda status. */
export class UpdateAppointmentDto {
  @SeInformado()
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
  @SeInformado()
  @IsBoolean()
  isWalkIn?: boolean;

  /** Convênio da consulta. `null` = particular. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  healthPlanId?: string | null;

  @SeInformado()
  @IsDateString()
  scheduledAt?: string;

  @SeInformado()
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes?: number;

  /** `null` (ou texto em branco) apaga a observação. */
  @IsOptional()
  @IsString()
  notes?: string | null;
}
