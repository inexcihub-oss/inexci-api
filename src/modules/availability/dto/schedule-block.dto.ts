import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

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
  @IsOptional()
  allDay?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  reason?: string | null;
}

export class UpdateScheduleBlockDto extends PartialType(
  CreateScheduleBlockDto,
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
