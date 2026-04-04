import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

/**
 * POST /surgery-requests/:id/mark-performed
 * Transição: SCHEDULED → PERFORMED
 */
export class MarkPerformedDto {
  @IsDateString()
  surgery_performed_at: string;

  @IsOptional()
  @IsBoolean()
  notify_patient?: boolean;
}
