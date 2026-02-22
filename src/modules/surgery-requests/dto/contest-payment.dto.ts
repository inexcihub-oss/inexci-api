import { IsString } from 'class-validator';

/**
 * POST /surgery-requests/:id/contest-payment
 * FINALIZED → FINALIZED (não muda status, registra contestação de pagamento)
 */
export class ContestPaymentDto {
  @IsString()
  to: string;

  @IsString()
  subject: string;

  @IsString()
  message: string;

  @IsString({ each: true })
  attachments?: string[];
}
