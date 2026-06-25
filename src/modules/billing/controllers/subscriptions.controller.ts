import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import { SkipConsentCheck } from 'src/shared/decorators/skip-consent-check.decorator';

import { SubscriptionService } from '../services/subscription.service';
import { QuotaService } from '../services/quota.service';
import { StartCheckoutDto } from '../dto/start-checkout.dto';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing/subscription')
export class SubscriptionsController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly quotaService: QuotaService,
  ) {}

  @Get()
  @SkipConsentCheck()
  @ApiOperation({ summary: 'Detalhes da assinatura do admin logado' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    const { subscription, daysLeftInTrial, daysUntilSuspension } =
      await this.subscriptionService.getMySubscription(user.userId);
    const quota = await this.quotaService.getQuotaSnapshot(
      subscription.ownerId,
    );
    return {
      subscription: {
        id: subscription.id,
        status: subscription.status,
        planId: subscription.planId,
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        canceledAt: subscription.canceledAt,
        suspendedAt: subscription.suspendedAt,
        pastDueSince: subscription.pastDueSince,
        gatewayProvider: subscription.gatewayProvider,
      },
      plan: subscription.plan
        ? {
            id: subscription.plan.id,
            slug: subscription.plan.slug,
            name: subscription.plan.name,
            description: subscription.plan.description,
            priceCents: subscription.plan.priceCents,
            currency: subscription.plan.currency,
            billingPeriod: subscription.plan.billingPeriod,
            surgeryRequestQuota: subscription.plan.surgeryRequestQuota,
            gatewayPriceId: subscription.plan.gatewayPriceId,
          }
        : null,
      quota,
      daysLeftInTrial,
      daysUntilSuspension,
    };
  }

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicia uma Checkout Session no Stripe para o plano escolhido' })
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartCheckoutDto,
  ) {
    return this.subscriptionService.startCheckout(user.userId, dto.planId);
  }

  @Post('portal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Abre o Customer Portal da Stripe para gerenciar a assinatura' })
  async portal(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionService.openBillingPortal(user.userId);
  }
}
