import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** Opcional, mas sem aceitar `null` (ausente passa; `null` é recusado). */
const SeInformado = () => ValidateIf((_, v: unknown) => v !== undefined);

export class CreateScheduleBlockDto {
  /** Profissional bloqueado. Ausente/nulo = toda a clínica. */
  @IsUUID()
  @IsOptional()
  doctorId?: string | null;

  @IsUUID()
  @IsOptional()
  clinicId?: string | null;

  /** ISO com fuso. */
  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;

  @IsBoolean()
  @SeInformado()
  allDay?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  reason?: string | null;
}

/**
 * `null` em início/fim é recusado (viraria 1970); profissional, clínica e
 * motivo aceitam nulo (`@IsOptional` próprio).
 */
export class UpdateScheduleBlockDto extends PartialType(
  CreateScheduleBlockDto,
  { skipNullProperties: false },
) {}

export class FindScheduleBlocksDto {
  @IsUUID()
  @IsOptional()
  doctorId?: string;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
