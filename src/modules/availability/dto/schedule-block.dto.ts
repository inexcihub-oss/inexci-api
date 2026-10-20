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

const SeInformado = () => ValidateIf((_, v: unknown) => v !== undefined);

export class CreateScheduleBlockDto {
  @IsUUID()
  @IsOptional()
  doctorId?: string | null;

  @IsUUID()
  @IsOptional()
  clinicId?: string | null;

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
