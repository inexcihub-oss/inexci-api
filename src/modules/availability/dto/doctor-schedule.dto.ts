import { PartialType, OmitType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Campo opcional que **não aceita `null`**: ausente passa, `null` cai nos
 * validadores do campo (e é recusado), em vez de virar `NULL` numa coluna
 * obrigatória. `@IsOptional` deixaria o `null` passar.
 */
const SeInformado = () => ValidateIf((_, v: unknown) => v !== undefined);

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateDoctorScheduleDto {
  /** Profissional da grade. Default: o próprio usuário. */
  @IsUUID()
  @IsOptional()
  doctorId?: string;

  @IsUUID()
  @IsOptional()
  clinicId?: string | null;

  @IsUUID()
  @IsOptional()
  roomId?: string | null;

  /** 0 = domingo … 6 = sábado. */
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  /** `HH:MM`, horário de São Paulo. */
  @Matches(HORA, { message: 'startTime deve estar no formato HH:MM' })
  startTime: string;

  @Matches(HORA, { message: 'endTime deve estar no formato HH:MM' })
  endTime: string;

  @IsInt()
  @Min(5)
  @Max(240)
  @SeInformado()
  slotMinutes?: number;

  @IsInt()
  @Min(0)
  @Max(50)
  @IsOptional()
  maxWalkIns?: number | null;

  @IsDateString()
  @IsOptional()
  validFrom?: string | null;

  @IsDateString()
  @IsOptional()
  validTo?: string | null;

  @IsBoolean()
  @SeInformado()
  active?: boolean;
}

/**
 * O profissional da grade não muda depois de criada. `skipNullProperties:
 * false`: `null` em campo obrigatório (dia, horário) é recusado; os que
 * aceitam nulo (clínica, sala, vigência…) têm `@IsOptional` próprio.
 */
export class UpdateDoctorScheduleDto extends PartialType(
  OmitType(CreateDoctorScheduleDto, ['doctorId'] as const),
  { skipNullProperties: false },
) {}
