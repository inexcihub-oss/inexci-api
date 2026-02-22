import { IsIn } from 'class-validator';

/**
 * POST /surgery-requests/:id/confirm-date
 * Transição: IN_SCHEDULING → SCHEDULED
 */
export class ConfirmDateDto {
  @IsIn([0, 1, 2])
  selected_date_index: 0 | 1 | 2;
}
