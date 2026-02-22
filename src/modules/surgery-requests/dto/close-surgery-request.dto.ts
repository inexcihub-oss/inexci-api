import { IsOptional, IsString } from 'class-validator';

/**
 * POST /surgery-requests/:id/close
 * Qualquer → CLOSED (exceto FINALIZED e CLOSED)
 */
export class CloseSurgeryRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
