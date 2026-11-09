import { AdminMetricsActivationDto } from '../../activation/dto/admin-activation.dto';
import { ApiProperty } from '@nestjs/swagger';
import { METRICS_PERIODS, MetricsPeriod } from '../metrics-formulas';
import { AdminSecuritySpikeDto } from '../../security/dto/admin-security.dto';

const SITUATIONS = [
  'trial',
  'trial_expired',
  'active',
  'cancel_scheduled',
  'past_due',
  'suspended',
  'canceled',
  'internal',
  'deactivated',
];

const nullableInt = { type: Number, nullable: true } as const;

export class AdminMetricsSituationCountDto {
  @ApiProperty({ enum: SITUATIONS }) situation: string;
  @ApiProperty() count: number;
}

export class AdminMetricsAccountsDto {
  @ApiProperty({
    description:
      'Contas cliente (todas as situações, inclusive canceladas), fora acesso interno',
  })
  total: number;
  @ApiProperty({ description: 'Assinaturas criadas no período' })
  newInPeriod: number;
  @ApiProperty({
    type: [AdminMetricsSituationCountDto],
    description: 'Inclui acesso interno (única exceção do D4)',
  })
  bySituation: AdminMetricsSituationCountDto[];
}

export class AdminMetricsTrialConversionDto {
  @ApiProperty({ type: String, format: 'date-time' }) cohortFrom: Date;
  @ApiProperty({ type: String, format: 'date-time' }) cohortTo: Date;
  @ApiProperty() started: number;
  @ApiProperty() converted: number;
  @ApiProperty({ ...nullableInt, description: 'Percentual, uma casa' })
  ratePercent: number | null;
}

export class AdminMetricsTrialsDto {
  @ApiProperty() active: number;
  @ApiProperty() endingIn7Days: number;
  @ApiProperty() expired: number;
  @ApiProperty({ type: AdminMetricsTrialConversionDto })
  conversion90d: AdminMetricsTrialConversionDto;
}

export class AdminMetricsRevenueDto {
  @ApiProperty() mrrCents: number;
  @ApiProperty() payingAccounts: number;
  @ApiProperty({
    ...nullableInt,
    description: 'MRR do snapshot do dia anterior ao início do período',
  })
  mrrPreviousCents: number | null;
  @ApiProperty({ ...nullableInt, description: 'Percentual, uma casa' })
  mrrChangePercent: number | null;
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty() receivedThisMonthCents: number;
  @ApiProperty({ example: '2026-11' }) nextMonth: string;
  @ApiProperty() nextMonthForecastCents: number;
  @ApiProperty() nextMonthForecastGuaranteedCents: number;
  @ApiProperty() nextMonthForecastTrialConversionCents: number;
  @ApiProperty({
    description: 'Sempre true: projeção local, sem prévia da Stripe',
  })
  nextMonthForecastIsEstimate: boolean;
  @ApiProperty() delinquentCents: number;
  @ApiProperty() delinquentAccounts: number;
}

export class AdminMetricsChurnDto {
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty() canceledAccounts: number;
  @ApiProperty(nullableInt) payingAccountsAtStart: number | null;
  @ApiProperty({ ...nullableInt, description: 'Percentual, uma casa' })
  accountsRatePercent: number | null;
  @ApiProperty() lostMrrCents: number;
  @ApiProperty(nullableInt) mrrAtStartCents: number | null;
  @ApiProperty({ ...nullableInt, description: 'Percentual, uma casa' })
  revenueRatePercent: number | null;
}

export class AdminMetricsEngagementDto {
  @ApiProperty() activeAccounts7d: number;
  @ApiProperty() activeAccounts30d: number;
  @ApiProperty() inactiveAccounts7d: number;
  @ApiProperty() surgeryRequestsCreated: number;
  @ApiProperty() appointments: number;
  @ApiProperty() patientsCreated: number;
}

export class AdminMetricsAiAccountDto {
  @ApiProperty() ownerId: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty({ description: 'Centavos de dólar' }) costUsdCents: number;
  @ApiProperty() totalTokens: number;
}

export class AdminMetricsAiDto {
  @ApiProperty({ description: 'Contas cliente, mês corrente (US$ centavos)' })
  costMonthUsdCents: number;
  @ApiProperty({
    description:
      'Toda a plataforma no mês, inclusive sem conta e acesso interno (bate com Uso de IA)',
  })
  platformCostMonthUsdCents: number;
  @ApiProperty() costLast30DaysUsdCents: number;
  @ApiProperty({
    ...nullableInt,
    description: 'Custo dos últimos 30 dias ÷ contas ativas em 30 dias',
  })
  averageCostPerActiveAccountUsdCents: number | null;
  @ApiProperty({ type: [AdminMetricsAiAccountDto] })
  topAccounts: AdminMetricsAiAccountDto[];
}

export class AdminMetricsErrorSpikeAccountDto {
  @ApiProperty() ownerId: string;
  @ApiProperty({ type: String, nullable: true }) ownerName: string | null;
  @ApiProperty() total: number;
}

export class AdminMetricsErrorsDto {
  @ApiProperty({
    description: 'Erros em 24 h a partir dos quais a conta entra no alerta',
  })
  spikeThreshold: number;
  @ApiProperty() accountsWithSpike24h: number;
  @ApiProperty({ type: [AdminMetricsErrorSpikeAccountDto] })
  topSpikeAccounts: AdminMetricsErrorSpikeAccountDto[];
}

export class AdminMetricsAccountAtRiskDto {
  @ApiProperty() ownerId: string;
  @ApiProperty() name: string;
  @ApiProperty({ minimum: 0, maximum: 100 }) score: number;
  @ApiProperty({ type: String, nullable: true }) mainReason: string | null;
}

export class AdminMetricsAccountsAtRiskDto {
  @ApiProperty({ description: 'Contas na faixa "em risco" no último cálculo' })
  total: number;
  @ApiProperty({ type: [AdminMetricsAccountAtRiskDto] })
  items: AdminMetricsAccountAtRiskDto[];
}

export class AdminMetricsMrrPointDto {
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty(nullableInt) mrrCents: number | null;
}

export class AdminMetricsNewVsCanceledPointDto {
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty() newAccounts: number;
  @ApiProperty() canceledAccounts: number;
}

export class AdminMetricsPlanPointDto {
  @ApiProperty() planId: string;
  @ApiProperty() planName: string;
  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'] }) billingPeriod: string;
  @ApiProperty() accounts: number;
}

export class AdminMetricsTrialFunnelDto {
  @ApiProperty() started: number;
  @ApiProperty() withCard: number;
  @ApiProperty() converted: number;
}

export class AdminMetricsSeriesDto {
  @ApiProperty({ type: [AdminMetricsMrrPointDto] })
  mrrMonthly: AdminMetricsMrrPointDto[];
  @ApiProperty({ type: [AdminMetricsNewVsCanceledPointDto] })
  newVsCanceled: AdminMetricsNewVsCanceledPointDto[];
  @ApiProperty({ type: [AdminMetricsPlanPointDto] })
  accountsByPlan: AdminMetricsPlanPointDto[];
  @ApiProperty({ type: AdminMetricsTrialFunnelDto })
  trialFunnel: AdminMetricsTrialFunnelDto;
}

export class AdminMetricsOverviewDto {
  @ApiProperty({ enum: METRICS_PERIODS }) period: MetricsPeriod;
  @ApiProperty({ type: String, format: 'date-time' }) from: Date;
  @ApiProperty({ type: String, format: 'date-time' }) to: Date;
  @ApiProperty({ type: AdminMetricsAccountsDto })
  accounts: AdminMetricsAccountsDto;
  @ApiProperty({ type: AdminMetricsTrialsDto }) trials: AdminMetricsTrialsDto;
  @ApiProperty({ type: AdminMetricsRevenueDto })
  revenue: AdminMetricsRevenueDto;
  @ApiProperty({ type: AdminMetricsChurnDto }) churn: AdminMetricsChurnDto;
  @ApiProperty({ type: AdminMetricsEngagementDto })
  engagement: AdminMetricsEngagementDto;
  @ApiProperty({ type: AdminMetricsAiDto }) ai: AdminMetricsAiDto;
  @ApiProperty({ type: AdminMetricsErrorsDto })
  errors: AdminMetricsErrorsDto;
  @ApiProperty({ type: AdminMetricsActivationDto })
  activation: AdminMetricsActivationDto;
  @ApiProperty({ type: AdminSecuritySpikeDto })
  security: AdminSecuritySpikeDto;
  @ApiProperty({ type: AdminMetricsAccountsAtRiskDto })
  accountsAtRisk: AdminMetricsAccountsAtRiskDto;
  @ApiProperty({ type: AdminMetricsSeriesDto })
  series: AdminMetricsSeriesDto;
}
