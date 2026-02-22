import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * POST /surgery-requests/:id/confirm-receipt
 * Transição: INVOICED → FINALIZED
 */
export class ConfirmReceiptDto {
  @IsNumber()
  @Min(0)
  received_value: number;

  @IsDateString()
  received_at: string;

  @IsOptional()
  @IsString()
  receipt_notes?: string;
}
