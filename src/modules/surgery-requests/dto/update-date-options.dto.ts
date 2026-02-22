import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
} from 'class-validator';

/**
 * PATCH /surgery-requests/:id/date-options
 * Atualiza opções de data sem mudar status (em IN_SCHEDULING)
 */
export class UpdateDateOptionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsDateString({}, { each: true })
  date_options: string[];
}
