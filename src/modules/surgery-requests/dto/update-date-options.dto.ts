import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
} from 'class-validator';

/**
 * PATCH /surgery-requests/:id/date-options
 * Atualiza opções de data sem mudar status (em IN_SCHEDULING) — exige 3 datas
 */
export class UpdateDateOptionsDto {
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsDateString({}, { each: true })
  dateOptions: string[];
}
