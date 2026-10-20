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

const SeInformado = () => ValidateIf((_, v: unknown) => v !== undefined);

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateDoctorScheduleDto {
  @IsUUID()
  @IsOptional()
  doctorId?: string;

  @IsUUID()
  @IsOptional()
  clinicId?: string | null;

  @IsUUID()
  @IsOptional()
  roomId?: string | null;

  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

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

export class UpdateDoctorScheduleDto extends PartialType(
  OmitType(CreateDoctorScheduleDto, ['doctorId'] as const),
  { skipNullProperties: false },
) {}
