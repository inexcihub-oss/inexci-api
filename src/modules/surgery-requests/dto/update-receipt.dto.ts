import { IsDateString, IsNumber, Min } from 'class-validator';

/**
 * PATCH /surgery-requests/:id/billing/receipt
 * Editar recebimento após contestação de pagamento (FINALIZED)
 */
export class UpdateReceiptDto {
  @IsNumber()
  @Min(0)
  receivedValue: number;

  @IsDateString()
  receivedAt: string;
}
