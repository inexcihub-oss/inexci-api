import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';

export const APPOINTMENTS_MAX_TAKE = 1000;

export function listaDaQuery(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  const partes = Array.isArray(value) ? value : [value];
  if (!partes.every((parte) => typeof parte === 'string')) return value;
  const itens = partes
    .flatMap((parte) => parte.split(','))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return itens.length > 0 ? itens : undefined;
}

export class FindAppointmentsDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @IsOptional()
  @Transform(({ value }) => listaDaQuery(value))
  @IsUUID('all', { each: true })
  doctorIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(APPOINTMENTS_MAX_TAKE)
  take?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  withDoctorCounts?: boolean;

  @IsOptional()
  @Transform(({ value }) => listaDaQuery(value))
  @IsEnum(AppointmentStatus, { each: true })
  status?: AppointmentStatus[];

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC';
}
