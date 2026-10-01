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
} from 'class-validator';

export class CreateHolidayDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** `YYYY-MM-DD`. */
  @IsDateString()
  date: string;

  @IsBoolean()
  @IsOptional()
  recurring?: boolean;

  @IsBoolean()
  @IsOptional()
  blocksAgenda?: boolean;
}

export class UpdateHolidayDto extends PartialType(CreateHolidayDto) {}

export class FindHolidaysDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  @IsOptional()
  year?: number;
}
