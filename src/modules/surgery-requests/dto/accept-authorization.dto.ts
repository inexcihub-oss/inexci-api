import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
} from 'class-validator';

/**
 * POST /surgery-requests/:id/accept-authorization
 * Transição: IN_ANALYSIS → IN_SCHEDULING
 */
export class AcceptAuthorizationDto {
  /** Mínimo 1 data, máximo 3 opções */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsDateString({}, { each: true })
  date_options: string[];
}
