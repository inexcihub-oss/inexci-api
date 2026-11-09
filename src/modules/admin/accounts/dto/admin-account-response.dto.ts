import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Permission } from 'src/shared/permissions';
import { AdminAccountSituation } from '../admin-account-situation';
import {
  ACCOUNT_HEALTH_BANDS,
  ACCOUNT_HEALTH_FACTOR_KEYS,
  AccountHealthBand,
  AccountHealthFactorKey,
} from 'src/database/entities/account-health-daily.entity';
import {
  AdminMemberOnboardingDto,
  AdminMemberUsageDto,
} from '../../activation/dto/admin-activation.dto';

const nullableDate = {
  type: String,
  format: 'date-time',
  nullable: true,
} as const;

export class AdminAccountPlanDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() priceCents: number;
  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'] }) billingPeriod: string;
}

export class AdminAccountQuotaDto {
  @ApiProperty() used: number;
  @ApiProperty({ description: '-1 = ilimitado' }) limit: number;
}

export class AdminAccountHealthFactorDto {
  @ApiProperty({ enum: ACCOUNT_HEALTH_FACTOR_KEYS })
  key: AccountHealthFactorKey;
  @ApiProperty({ description: 'Pontos perdidos por este fator' })
  points: number;
  @ApiProperty() message: string;
}

export class AdminAccountHealthSummaryDto {
  @ApiProperty({ minimum: 0, maximum: 100 }) score: number;
  @ApiProperty({ enum: ACCOUNT_HEALTH_BANDS }) band: AccountHealthBand;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Fator que mais pesou na nota',
  })
  mainReason: string | null;
}

export class AdminAccountHealthDetailDto extends AdminAccountHealthSummaryDto {
  @ApiProperty({ type: [AdminAccountHealthFactorDto] })
  factors: AdminAccountHealthFactorDto[];
  @ApiProperty({ type: String, format: 'date-time' }) computedAt: Date;
}

export class AdminAccountHealthPointDto {
  @ApiProperty({ description: 'YYYY-MM-DD (São Paulo)' }) day: string;
  @ApiProperty() score: number;
  @ApiProperty({ enum: ACCOUNT_HEALTH_BANDS }) band: AccountHealthBand;
}

export class AdminAccountItemDto {
  @ApiProperty() ownerId: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: AdminAccountPlanDto }) plan: AdminAccountPlanDto;
  @ApiProperty({ enum: AdminAccountSituation })
  situation: AdminAccountSituation;
  @ApiProperty({ type: Number, nullable: true }) daysLeft: number | null;
  @ApiProperty({ type: Number, nullable: true }) daysOverdue: number | null;
  @ApiProperty(nullableDate) trialEndsAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) currentPeriodEnd: Date;
  @ApiProperty({
    description: 'Centavos por mês; 0 fora de ativa/inadimplente',
  })
  monthlyAmountCents: number;
  @ApiProperty() hasGatewaySubscription: boolean;
  @ApiProperty() doctors: number;
  @ApiProperty() collaborators: number;
  @ApiProperty() surgeryRequestsThisMonth: number;
  @ApiProperty() surgeryRequestsTotal: number;
  @ApiProperty({ type: AdminAccountQuotaDto }) quota: AdminAccountQuotaDto;
  @ApiProperty() appointmentsThisMonth: number;
  @ApiProperty({ description: 'Centavos de dólar' })
  aiCostThisMonthUsdCents: number;
  @ApiProperty(nullableDate) lastSeenAt: Date | null;
  @ApiProperty({
    ...nullableDate,
    description: 'Preenchido quando o painel desativou a conta inteira',
  })
  accountDeactivatedAt: Date | null;
  @ApiProperty({
    type: AdminAccountHealthSummaryDto,
    nullable: true,
    description: 'Nula para conta cancelada, desativada ou ainda não avaliada',
  })
  health: AdminAccountHealthSummaryDto | null;
}

export class AdminAccountCountsDto {
  @ApiProperty() all: number;
  @ApiProperty() trial: number;
  @ApiProperty() trial_expired: number;
  @ApiProperty() active: number;
  @ApiProperty() cancel_scheduled: number;
  @ApiProperty() past_due: number;
  @ApiProperty() suspended: number;
  @ApiProperty() canceled: number;
  @ApiProperty() internal: number;
  @ApiProperty() deactivated: number;
}

export class AdminAccountListResponseDto {
  @ApiProperty({ type: [AdminAccountItemDto] }) items: AdminAccountItemDto[];
  @ApiProperty() total: number;
  @ApiProperty({ type: AdminAccountCountsDto }) counts: AdminAccountCountsDto;
}

export class AdminSurgeryRequestStatusCountDto {
  @ApiProperty({ description: 'Código do SurgeryRequestStatus (1 a 9)' })
  status: number;
  @ApiProperty() total: number;
  @ApiProperty() inPeriod: number;
}

export class AdminAppointmentCountsDto {
  @ApiProperty() scheduled: number;
  @ApiProperty() completed: number;
  @ApiProperty() cancelled: number;
  @ApiProperty() noShow: number;
}

export class AdminPatientCountsDto {
  @ApiProperty() total: number;
  @ApiProperty() newInPeriod: number;
}

export class AdminActivityPointDto {
  @ApiProperty({ description: 'Segunda-feira da semana (YYYY-MM-DD, SP)' })
  weekStart: string;
  @ApiProperty() surgeryRequests: number;
  @ApiProperty() appointments: number;
}

export class AdminAccountUsageDto {
  @ApiProperty({ type: String, format: 'date-time' }) from: Date;
  @ApiProperty({ type: String, format: 'date-time' }) to: Date;
  @ApiProperty({ type: [AdminSurgeryRequestStatusCountDto] })
  surgeryRequestsByStatus: AdminSurgeryRequestStatusCountDto[];
  @ApiProperty({ type: AdminAppointmentCountsDto })
  appointments: AdminAppointmentCountsDto;
  @ApiProperty({ type: AdminPatientCountsDto })
  patients: AdminPatientCountsDto;
  @ApiProperty() finalizedRecordsInPeriod: number;
  @ApiProperty() aiMessagesInPeriod: number;
  @ApiProperty({ type: [AdminActivityPointDto] })
  activity: AdminActivityPointDto[];
}

export class AdminAccountDetailDto extends AdminAccountItemDto {
  @ApiProperty({ type: AdminAccountUsageDto }) usage: AdminAccountUsageDto;
  @ApiProperty({ type: String, nullable: true })
  accountDeactivatedByName: string | null;
  @ApiProperty({ type: AdminAccountHealthDetailDto, nullable: true })
  healthDetail: AdminAccountHealthDetailDto | null;
  @ApiProperty({ type: [AdminAccountHealthPointDto] })
  healthHistory: AdminAccountHealthPointDto[];
}

export enum AdminTeamRole {
  OWNER = 'owner',
  DOCTOR = 'doctor',
  COLLABORATOR = 'collaborator',
}

export enum AdminTeamMemberStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  INACTIVE = 'inactive',
}

export class AdminTeamMemberDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty({ enum: AdminTeamRole }) role: AdminTeamRole;
  @ApiProperty() isDoctor: boolean;
  @ApiProperty({ enum: Permission, isArray: true })
  permissions: Permission[];
  @ApiProperty() active: boolean;
  @ApiProperty({ enum: AdminTeamMemberStatus }) status: AdminTeamMemberStatus;
  @ApiProperty(nullableDate) lastSeenAt: Date | null;
  @ApiProperty() mfaEnabled: boolean;
  @ApiProperty(nullableDate) privacyPolicyAcceptedAt: Date | null;
  @ApiProperty(nullableDate) termsOfUseAcceptedAt: Date | null;
  @ApiProperty(nullableDate) aiConsentAcceptedAt: Date | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Telefone do WhatsApp mascarado (só os 4 últimos dígitos)',
  })
  whatsappPhoneMasked: string | null;
  @ApiProperty({ type: AdminMemberOnboardingDto })
  onboarding: AdminMemberOnboardingDto;
  @ApiProperty({ type: AdminMemberUsageDto })
  usage: AdminMemberUsageDto;
}

export class AdminTeamResponseDto {
  @ApiProperty({ type: String, format: 'date-time' }) from: Date;
  @ApiProperty({ type: String, format: 'date-time' }) to: Date;
  @ApiProperty() days: number;
  @ApiProperty({ type: [AdminTeamMemberDto] }) items: AdminTeamMemberDto[];
}

export class AdminAccountGatewayDiscountDto {
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: Number, nullable: true }) percentOff: number | null;
  @ApiProperty({ type: Number, nullable: true }) amountOffCents: number | null;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['once', 'repeating', 'forever'],
  })
  duration: string | null;
  @ApiPropertyOptional({
    ...nullableDate,
    description: 'Fim do desconto (só cupom repetindo)',
  })
  endsAt?: Date | null;
}

export class AdminAccountGatewayDto {
  @ApiProperty({ type: String, nullable: true }) status: string | null;
  @ApiProperty(nullableDate) trialEndsAt: Date | null;
  @ApiProperty(nullableDate) currentPeriodEnd: Date | null;
  @ApiProperty() cancelAtPeriodEnd: boolean;
  @ApiProperty({ type: AdminAccountGatewayDiscountDto, nullable: true })
  discount: AdminAccountGatewayDiscountDto | null;
  @ApiProperty() hasPaymentMethod: boolean;
  @ApiProperty({ type: String, nullable: true }) paymentBrand: string | null;
  @ApiProperty({ type: String, nullable: true }) paymentLast4: string | null;
}

export class AdminAccountSubscriptionDto {
  @ApiProperty({ enum: AdminAccountSituation })
  situation: AdminAccountSituation;
  @ApiProperty({ type: Number, nullable: true }) daysLeft: number | null;
  @ApiProperty({ type: Number, nullable: true }) daysOverdue: number | null;
  @ApiProperty() status: string;
  @ApiProperty({ type: AdminAccountPlanDto }) plan: AdminAccountPlanDto;
  @ApiProperty() monthlyAmountCents: number;
  @ApiProperty(nullableDate) trialEndsAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' })
  currentPeriodStart: Date;
  @ApiProperty({ type: String, format: 'date-time' }) currentPeriodEnd: Date;
  @ApiProperty() cancelAtPeriodEnd: boolean;
  @ApiProperty(nullableDate) pastDueSince: Date | null;
  @ApiProperty(nullableDate) suspendedAt: Date | null;
  @ApiProperty(nullableDate) canceledAt: Date | null;
  @ApiProperty({ type: String, nullable: true })
  gatewayCustomerId: string | null;
  @ApiProperty({ type: String, nullable: true })
  gatewaySubscriptionId: string | null;
  @ApiProperty({ type: String, nullable: true })
  stripeCustomerUrl: string | null;
  @ApiProperty({ type: AdminAccountGatewayDto, nullable: true })
  gateway: AdminAccountGatewayDto | null;
  @ApiProperty({
    description: 'true quando a leitura ao vivo da Stripe falhou',
  })
  gatewayError: boolean;
  @ApiProperty({
    description:
      'Mesma regra de POST grant-internal-access: sem assinatura viva na Stripe',
  })
  canGrantInternalAccess: boolean;
  @ApiProperty({ type: String, nullable: true })
  internalAccessBlockedReason: string | null;
  @ApiProperty({
    description:
      'Mesma regra de POST extend-trial: trial local ou assinatura em trial na Stripe',
  })
  canExtendTrial: boolean;
  @ApiProperty({
    description:
      'Mesma regra de POST deactivate: sem assinatura com cobrança na Stripe',
  })
  canDeactivate: boolean;
  @ApiProperty({ type: String, nullable: true })
  deactivationBlockedReason: string | null;
  @ApiProperty({ type: String, nullable: true })
  trialExtensionBlockedReason: string | null;
  @ApiProperty(nullableDate) internalAccessGrantedAt: Date | null;
  @ApiProperty({ type: String, nullable: true })
  internalAccessGrantedByName: string | null;
}
