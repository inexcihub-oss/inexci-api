import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from 'src/database/entities/user.entity';
import { SubscriptionPlan } from 'src/database/entities/subscription-plan.entity';
import { Subscription } from 'src/database/entities/subscription.entity';
import { SubscriptionQuotaPeriod } from 'src/database/entities/subscription-quota-period.entity';
import { PaymentGatewayEvent } from 'src/database/entities/payment-gateway-event.entity';

import { UserRepository } from 'src/database/repositories/user.repository';
import { SubscriptionPlanRepository } from 'src/database/repositories/subscription-plan.repository';
import { SubscriptionRepository } from 'src/database/repositories/subscription.repository';
import { SubscriptionQuotaPeriodRepository } from 'src/database/repositories/subscription-quota-period.repository';
import { PaymentGatewayEventRepository } from 'src/database/repositories/payment-gateway-event.repository';

import { PaymentGatewayModule } from 'src/shared/payment-gateway';

import { SubscriptionService } from './services/subscription.service';
import { QuotaService } from './services/quota.service';
import { BillingWebhookService } from './services/billing-webhook.service';

import { PlansController } from './controllers/plans.controller';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { BillingWebhooksController } from './controllers/billing-webhooks.controller';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      User,
      SubscriptionPlan,
      Subscription,
      SubscriptionQuotaPeriod,
      PaymentGatewayEvent,
    ]),
    PaymentGatewayModule,
  ],
  providers: [
    UserRepository,
    SubscriptionPlanRepository,
    SubscriptionRepository,
    SubscriptionQuotaPeriodRepository,
    PaymentGatewayEventRepository,
    SubscriptionService,
    QuotaService,
    BillingWebhookService,
  ],
  controllers: [
    PlansController,
    SubscriptionsController,
    BillingWebhooksController,
  ],
  exports: [SubscriptionService, QuotaService],
})
export class BillingModule {}
