import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Opcional, mas sem aceitar `null` (ausente passa; `null` é recusado). */
const SeInformado = () => ValidateIf((_, v: unknown) => v !== undefined);

export class CreateHolidayDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** `YYYY-MM-DD`. */
  @IsDateString()
  date: string;

  @IsBoolean()
  @SeInformado()
  recurring?: boolean;

  @IsBoolean()
  @SeInformado()
  blocksAgenda?: boolean;
}

/** `null` em qualquer campo é recusado (nenhum deles é anulável). */
export class UpdateHolidayDto extends PartialType(CreateHolidayDto, {
  skipNullProperties: false,
}) {}

export class FindHolidaysDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  @IsOptional()
  year?: number;
}
