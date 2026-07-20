import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
} from 'class-validator';

/**
 * PATCH /surgery-requests/:id/date-options
 * Atualiza opções de data sem mudar status (em IN_SCHEDULING) — 1 a 3 datas
 */
export class UpdateDateOptionsDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  notifyPatient?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsDateString({}, { each: true })
  dateOptions: string[];
}
