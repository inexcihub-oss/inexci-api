import { ApiProperty } from '@nestjs/swagger';

const nullableDate = {
  type: String,
  format: 'date-time',
  nullable: true,
} as const;

const INVOICE_STATUSES = ['draft', 'open', 'paid', 'void', 'uncollectible'];

export class AdminMonthlyReceivedDto {
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty() receivedCents: number;
}

export class AdminRevenueSummaryDto {
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty({ description: 'Soma de amount_paid das faturas pagas no mês' })
  receivedCents: number;
  @ApiProperty() receivedInvoices: number;
  @ApiProperty({ description: 'Descontos das faturas pagas no mês' })
  discountsCents: number;
  @ApiProperty({ description: 'Soma do que falta pagar nas faturas abertas' })
  openCents: number;
  @ApiProperty() openInvoices: number;
  @ApiProperty({ description: 'Aberto das contas inadimplentes e suspensas' })
  delinquentCents: number;
  @ApiProperty() delinquentAccounts: number;
  @ApiProperty() mrrCents: number;
  @ApiProperty() arrCents: number;
  @ApiProperty() payingAccounts: number;
  @ApiProperty({ description: 'MRR ÷ contas pagantes, arredondado' })
  averageTicketCents: number;
  @ApiProperty({ type: [AdminMonthlyReceivedDto] })
  receivedByMonth: AdminMonthlyReceivedDto[];
}

export class AdminForecastItemDto {
  @ApiProperty() ownerId: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty({ enum: ['guaranteed', 'trial_conversion'] })
  kind: 'guaranteed' | 'trial_conversion';
  @ApiProperty({ type: String, format: 'date-time' }) chargeAt: Date;
  @ApiProperty() amountCents: number;
  @ApiProperty({ enum: ['preview', 'projection'] })
  source: 'preview' | 'projection';
}

export class AdminForecastMonthDto {
  @ApiProperty({ example: '2026-11' }) month: string;
  @ApiProperty() guaranteedCents: number;
  @ApiProperty() trialConversionCents: number;
  @ApiProperty({ type: [AdminForecastItemDto] })
  items: AdminForecastItemDto[];
}

export class AdminForecastResponseDto {
  @ApiProperty({ type: String, format: 'date-time' }) generatedAt: Date;
  @ApiProperty({
    description:
      'Alguma leitura da Stripe falhou e aquela parte usou a projeção local',
  })
  partial: boolean;
  @ApiProperty() totalGuaranteedCents: number;
  @ApiProperty() totalTrialConversionCents: number;
  @ApiProperty({
    type: [AdminForecastMonthDto],
    description: 'O primeiro mês é o corrente (a partir de agora)',
  })
  months: AdminForecastMonthDto[];
}

export class AdminInvoiceDto {
  @ApiProperty() id: string;
  @ApiProperty() gatewayInvoiceId: string;
  @ApiProperty({ type: String, nullable: true }) ownerId: string | null;
  @ApiProperty({ type: String, nullable: true }) ownerName: string | null;
  @ApiProperty({ type: String, nullable: true }) ownerEmail: string | null;
  @ApiProperty({ enum: INVOICE_STATUSES }) status: string;
  @ApiProperty() amountDueCents: number;
  @ApiProperty() amountPaidCents: number;
  @ApiProperty() amountRemainingCents: number;
  @ApiProperty() amountDiscountCents: number;
  @ApiProperty() currency: string;
  @ApiProperty({ type: String, nullable: true }) couponCode: string | null;
  @ApiProperty(nullableDate) dueDate: Date | null;
  @ApiProperty(nullableDate) paidAt: Date | null;
  @ApiProperty(nullableDate) periodStart: Date | null;
  @ApiProperty(nullableDate) periodEnd: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) invoiceCreatedAt: Date;
  @ApiProperty({ type: String, nullable: true })
  hostedInvoiceUrl: string | null;
}

export class AdminInvoiceListResponseDto {
  @ApiProperty({ type: [AdminInvoiceDto] }) items: AdminInvoiceDto[];
  @ApiProperty() total: number;
  @ApiProperty() limit: number;
  @ApiProperty() offset: number;
}

export class AdminDelinquentAccountDto {
  @ApiProperty() ownerId: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty() planName: string;
  @ApiProperty({ enum: ['past_due', 'suspended'] })
  status: 'past_due' | 'suspended';
  @ApiProperty() openCents: number;
  @ApiProperty() openInvoices: number;
  @ApiProperty(nullableDate) pastDueSince: Date | null;
  @ApiProperty({ type: Number, nullable: true }) daysOverdue: number | null;
  @ApiProperty({
    ...nullableDate,
    description: 'Inadimplente: quando suspende; suspensa: quando suspendeu',
  })
  suspensionDate: Date | null;
}

export class AdminDelinquencyResponseDto {
  @ApiProperty() totalOpenCents: number;
  @ApiProperty({ type: [AdminDelinquentAccountDto] })
  items: AdminDelinquentAccountDto[];
}

export class AdminPlanDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'] }) billingPeriod: string;
  @ApiProperty() priceCents: number;
  @ApiProperty() currency: string;
  @ApiProperty({ description: '-1 = ilimitado' }) surgeryRequestQuota: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty() isTrialDefault: boolean;
  @ApiProperty({ type: String, nullable: true })
  gatewayPriceId: string | null;
  @ApiProperty({ description: 'Contas no plano (sem canceladas e internas)' })
  accounts: number;
  @ApiProperty({ type: Number, nullable: true })
  gatewayPriceCents: number | null;
  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'], nullable: true })
  gatewayCycle: 'MONTHLY' | 'YEARLY' | null;
  @ApiProperty({ type: String, nullable: true })
  gatewayCurrency: string | null;
  @ApiProperty({ type: Boolean, nullable: true })
  gatewayPriceActive: boolean | null;
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      'Valor, período ou moeda diferente da Stripe; null sem preço vinculado ou com a Stripe fora',
  })
  divergent: boolean | null;
  @ApiProperty() gatewayError: boolean;
}
