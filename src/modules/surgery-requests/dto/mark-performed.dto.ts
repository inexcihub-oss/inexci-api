import { IsDateString } from 'class-validator';

/**
 * POST /surgery-requests/:id/mark-performed
 * Transição: SCHEDULED → PERFORMED
 */
export class MarkPerformedDto {
  @IsDateString()
  surgery_performed_at: string;
}
