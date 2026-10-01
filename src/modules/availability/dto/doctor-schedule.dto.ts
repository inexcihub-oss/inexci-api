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
} from 'class-validator';

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
  @IsOptional()
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
  @IsOptional()
  active?: boolean;
}

/** O profissional da grade não muda depois de criada. */
export class UpdateDoctorScheduleDto extends PartialType(
  OmitType(CreateDoctorScheduleDto, ['doctorId'] as const),
) {}
