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
  invoice_protocol: string;

  @IsDateString()
  invoice_sent_at: string;

  @IsNumber()
  @Min(0)
  invoice_value: number;

  @IsOptional()
  @IsDateString()
  payment_deadline?: string;

  /**
   * Se true, atualiza health_plan.default_payment_days com base no prazo informado
   */
  @IsOptional()
  @IsBoolean()
  set_as_default_for_health_plan?: boolean;
}
