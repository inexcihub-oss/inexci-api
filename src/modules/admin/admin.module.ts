import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiTokenUsageLog } from '../../database/entities/ai-token-usage-log.entity';
import { NotificationSendLog } from '../../database/entities/notification-send-log.entity';
import { AdminController } from './admin.controller';
import { AiUsageService } from './ai-usage.service';
import { AiEfficiencyService } from './ai-efficiency.service';
import { NotificationLogsService } from './notification-logs.service';
import { PlatformAuditController } from './audit/platform-audit.controller';
import { PlatformAuditService } from './audit/platform-audit.service';
import { PaymentGatewayModule } from '../../shared/payment-gateway';
import { AdminAccountsController } from './accounts/admin-accounts.controller';
import { AdminAccountsService } from './accounts/admin-accounts.service';
import { AdminAccountStatusService } from './accounts/admin-account-status.service';
import { AdminActivationService } from './activation/admin-activation.service';
import { AdminSubscriptionsController } from './subscriptions/admin-subscriptions.controller';
import { AdminSubscriptionsService } from './subscriptions/admin-subscriptions.service';
import { AdminTeamController } from './team/admin-team.controller';
import { AdminTeamService } from './team/admin-team.service';
import { AdminUsageController } from './usage/admin-usage.controller';
import { AdminUsageService } from './usage/admin-usage.service';
import { AdminRevenueController } from './revenue/admin-revenue.controller';
import { AdminRevenueService } from './revenue/admin-revenue.service';
import { AdminCouponsController } from './coupons/admin-coupons.controller';
import { AdminCouponsService } from './coupons/admin-coupons.service';
import { AdminMetricsController } from './metrics/admin-metrics.controller';
import { AdminMetricsService } from './metrics/admin-metrics.service';
import { MetricsSnapshotService } from './metrics/metrics-snapshot.service';
import { AuthModule } from '../auth/auth.module';
import { AdminAuthModule } from './auth/admin-auth.module';
import { AdminSystemController } from './system/admin-system.controller';
import { AdminErrorsController } from './errors/admin-errors.controller';
import { AdminErrorsService } from './errors/admin-errors.service';
import { GrafanaLokiClient } from './errors/grafana-loki.client';
import { AccountHealthService } from './health/account-health.service';
import { AdminQueuesController } from './queues/admin-queues.controller';
import { AdminQueuesService } from './queues/admin-queues.service';
import { AdminGatewayEventsController } from './gateway-events/admin-gateway-events.controller';
import { AdminGatewayEventsService } from './gateway-events/admin-gateway-events.service';
import { AdminSecurityController } from './security/admin-security.controller';
import { AdminSecurityService } from './security/admin-security.service';
import { AdminClinicalAccessController } from './clinical-access/admin-clinical-access.controller';
import { AdminClinicalAccessService } from './clinical-access/admin-clinical-access.service';
import { QueuesModule } from '../../shared/queues/queues.module';
import { BillingModule } from '../billing/billing.module';
import { AdminSystemService } from './system/admin-system.service';
import { DistributedLockModule } from '../../shared/locks/distributed-lock.module';
import { MailModule } from '../../shared/mail/mail.module';
import { NotificationSendLogRepository } from '../../database/repositories/notification-send-log.repository';
import { AiTokenUsageLogRepository } from '../../database/repositories/ai-token-usage-log.repository';
import { SubscriptionRepository } from '../../database/repositories/subscription.repository';
import { SubscriptionPlanRepository } from '../../database/repositories/subscription-plan.repository';
import { SubscriptionQuotaPeriodRepository } from '../../database/repositories/subscription-quota-period.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiTokenUsageLog, NotificationSendLog]),
    PaymentGatewayModule,
    AuthModule,
    AdminAuthModule,
    MailModule,
    QueuesModule,
    BillingModule,
    DistributedLockModule,
  ],
  controllers: [
    AdminController,
    PlatformAuditController,
    AdminAccountsController,
    AdminSubscriptionsController,
    AdminTeamController,
    AdminUsageController,
    AdminRevenueController,
    AdminCouponsController,
    AdminMetricsController,
    AdminSystemController,
    AdminErrorsController,
    AdminQueuesController,
    AdminGatewayEventsController,
    AdminSecurityController,
    AdminClinicalAccessController,
  ],
  providers: [
    AiUsageService,
    AiEfficiencyService,
    NotificationLogsService,
    PlatformAuditService,
    AdminAccountsService,
    AdminAccountStatusService,
    AdminActivationService,
    AdminSubscriptionsService,
    AdminTeamService,
    AdminUsageService,
    AdminRevenueService,
    AdminCouponsService,
    AdminMetricsService,
    MetricsSnapshotService,
    AdminSystemService,
    AdminErrorsService,
    GrafanaLokiClient,
    AccountHealthService,
    AdminQueuesService,
    AdminGatewayEventsService,
    AdminSecurityService,
    AdminClinicalAccessService,
    AiTokenUsageLogRepository,
    NotificationSendLogRepository,
    SubscriptionRepository,
    SubscriptionPlanRepository,
    SubscriptionQuotaPeriodRepository,
  ],
  exports: [PlatformAuditService, AdminSystemService],
})
export class AdminModule {}
