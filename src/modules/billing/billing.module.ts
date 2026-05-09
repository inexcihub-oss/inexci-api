import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from 'src/database/entities/user.entity';
import { SubscriptionPlan } from 'src/database/entities/subscription-plan.entity';
import { Subscription } from 'src/database/entities/subscription.entity';
import { PaymentMethod } from 'src/database/entities/payment-method.entity';
import { Invoice } from 'src/database/entities/invoice.entity';
import { SubscriptionQuotaPeriod } from 'src/database/entities/subscription-quota-period.entity';
import { PaymentGatewayEvent } from 'src/database/entities/payment-gateway-event.entity';

import { UserRepository } from 'src/database/repositories/user.repository';
import { SubscriptionPlanRepository } from 'src/database/repositories/subscription-plan.repository';
import { SubscriptionRepository } from 'src/database/repositories/subscription.repository';
import { PaymentMethodRepository } from 'src/database/repositories/payment-method.repository';
import { InvoiceRepository } from 'src/database/repositories/invoice.repository';
import { SubscriptionQuotaPeriodRepository } from 'src/database/repositories/subscription-quota-period.repository';
import { PaymentGatewayEventRepository } from 'src/database/repositories/payment-gateway-event.repository';

import { PaymentGatewayModule } from 'src/shared/payment-gateway';
import { MailModule } from 'src/shared/mail/mail.module';

import { SubscriptionService } from './services/subscription.service';
import { QuotaService } from './services/quota.service';
import { PaymentMethodService } from './services/payment-method.service';
import { InvoiceService } from './services/invoice.service';
import { BillingWebhookService } from './services/billing-webhook.service';
import { BillingCronService } from './services/billing-cron.service';

import { PlansController } from './controllers/plans.controller';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { PaymentMethodsController } from './controllers/payment-methods.controller';
import { InvoicesController } from './controllers/invoices.controller';
import { BillingWebhooksController } from './controllers/billing-webhooks.controller';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      User,
      SubscriptionPlan,
      Subscription,
      PaymentMethod,
      Invoice,
      SubscriptionQuotaPeriod,
      PaymentGatewayEvent,
    ]),
    PaymentGatewayModule,
    MailModule,
  ],
  providers: [
    UserRepository,
    SubscriptionPlanRepository,
    SubscriptionRepository,
    PaymentMethodRepository,
    InvoiceRepository,
    SubscriptionQuotaPeriodRepository,
    PaymentGatewayEventRepository,
    SubscriptionService,
    QuotaService,
    PaymentMethodService,
    InvoiceService,
    BillingWebhookService,
    BillingCronService,
  ],
  controllers: [
    PlansController,
    SubscriptionsController,
    PaymentMethodsController,
    InvoicesController,
    BillingWebhooksController,
  ],
  exports: [SubscriptionService, QuotaService],
})
export class BillingModule {}
