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
  receivedValue: number;

  @IsDateString()
  receivedAt: string;

  @IsOptional()
  @IsString()
  receiptNotes?: string;
}
