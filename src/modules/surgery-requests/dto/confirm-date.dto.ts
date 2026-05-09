import { IsBoolean, IsIn, IsOptional } from 'class-validator';

/**
 * POST /surgery-requests/:id/confirm-date
 * Transição: IN_SCHEDULING → SCHEDULED
 */
export class ConfirmDateDto {
  @IsOptional()
  @IsBoolean()
  notify_patient?: boolean;
  @IsIn([0, 1, 2])
  selectedDateIndex: 0 | 1 | 2;
}
