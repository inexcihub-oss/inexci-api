import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
} from 'class-validator';

/**
 * POST /surgery-requests/:id/accept-authorization
 * Transição: IN_ANALYSIS → IN_SCHEDULING
 */
export class AcceptAuthorizationDto {
  @IsOptional()
  @IsBoolean()
  notifyPatient?: boolean;

  /** Exatamente 3 datas obrigatórias */
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsDateString({}, { each: true })
  dateOptions: string[];
}
