import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

/**
 * POST /surgery-requests/:id/mark-performed
 * Transição: SCHEDULED → PERFORMED
 */
export class MarkPerformedDto {
  @IsDateString()
  surgeryPerformedAt: string;

  @IsOptional()
  @IsBoolean()
  notifyPatient?: boolean;
}
