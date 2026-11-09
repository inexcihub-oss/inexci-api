import { ApiProperty } from '@nestjs/swagger';
import { AdminAccountSituation } from '../../accounts/admin-account-situation';
import {
  AdminAccountPlanDto,
  AdminAppointmentCountsDto,
} from '../../accounts/dto/admin-account-response.dto';

export class AdminUsageTotalsDto {
  @ApiProperty() surgeryRequestsCreated: number;
  @ApiProperty({ description: 'SCs com sent_at no período' })
  surgeryRequestsSent: number;
  @ApiProperty({ type: AdminAppointmentCountsDto })
  appointments: AdminAppointmentCountsDto;
  @ApiProperty() patientsCreated: number;
  @ApiProperty() recordsFinalized: number;
}

export class AdminUsageWeekDto extends AdminUsageTotalsDto {
  @ApiProperty({ description: 'Segunda-feira da semana (YYYY-MM-DD, SP)' })
  weekStart: string;
}

export class AdminUsageActiveAccountsDto {
  @ApiProperty() last7Days: number;
  @ApiProperty() last30Days: number;
  @ApiProperty() totalClients: number;
}

export class AdminUsageRankingItemDto {
  @ApiProperty() ownerId: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty() count: number;
}

export class AdminUsageResponseDto {
  @ApiProperty({ type: String, format: 'date-time' }) from: Date;
  @ApiProperty({ type: String, format: 'date-time' }) to: Date;
  @ApiProperty({ type: AdminUsageTotalsDto }) totals: AdminUsageTotalsDto;
  @ApiProperty({ type: [AdminUsageWeekDto] }) weekly: AdminUsageWeekDto[];
  @ApiProperty({ type: AdminUsageActiveAccountsDto })
  activeAccounts: AdminUsageActiveAccountsDto;
  @ApiProperty({ type: [AdminUsageRankingItemDto] })
  topBySurgeryRequests: AdminUsageRankingItemDto[];
  @ApiProperty({ type: [AdminUsageRankingItemDto] })
  topByAppointments: AdminUsageRankingItemDto[];
}

export class AdminInactiveAccountDto {
  @ApiProperty() ownerId: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty({ type: AdminAccountPlanDto }) plan: AdminAccountPlanDto;
  @ApiProperty({ enum: AdminAccountSituation })
  situation: AdminAccountSituation;
  @ApiProperty({ type: Number, nullable: true }) daysLeft: number | null;
  @ApiProperty({ type: Number, nullable: true }) daysOverdue: number | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Nulo quando ninguém da conta acessou',
  })
  lastSeenAt: Date | null;
  @ApiProperty({ type: Number, nullable: true })
  daysSinceLastSeen: number | null;
}

export class AdminInactiveAccountsResponseDto {
  @ApiProperty() days: number;
  @ApiProperty() total: number;
  @ApiProperty({ type: [AdminInactiveAccountDto] })
  items: AdminInactiveAccountDto[];
}
