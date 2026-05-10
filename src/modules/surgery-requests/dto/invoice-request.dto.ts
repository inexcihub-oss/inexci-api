import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * POST /surgery-requests/:id/invoice
 * Transição: PERFORMED → INVOICED
 */
export class InvoiceRequestDto {
  @IsString()
  invoiceProtocol: string;

  @IsDateString()
  invoiceSentAt: string;

  @IsNumber()
  @Min(0)
  invoiceValue: number;

  @IsOptional()
  @IsDateString()
  paymentDeadline?: string;

  /**
   * Se true, atualiza healthPlan.defaultPaymentDays com base no prazo informado
   */
  @IsOptional()
  @IsBoolean()
  setAsDefaultForHealthPlan?: boolean;
}
