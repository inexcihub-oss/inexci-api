import { IsDateString } from 'class-validator';

/**
 * PATCH /surgery-requests/:id/reschedule
 * Reagenda sem mudar status (em SCHEDULED)
 */
export class RescheduleDto {
  @IsDateString()
  new_date: string;
}
