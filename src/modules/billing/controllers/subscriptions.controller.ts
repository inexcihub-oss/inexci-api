import { Body, Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import { SkipConsentCheck } from 'src/shared/decorators/skip-consent-check.decorator';

import { SubscriptionService } from '../services/subscription.service';
import { QuotaService } from '../services/quota.service';
import { ChangePlanDto } from '../dto/change-plan.dto';

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
        nextPlanId: subscription.nextPlanId,
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        canceledAt: subscription.canceledAt,
        suspendedAt: subscription.suspendedAt,
        pastDueSince: subscription.pastDueSince,
        defaultPaymentMethodId: subscription.defaultPaymentMethodId,
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
          }
        : null,
      nextPlan: subscription.nextPlan
        ? {
            id: subscription.nextPlan.id,
            slug: subscription.nextPlan.slug,
            name: subscription.nextPlan.name,
            priceCents: subscription.nextPlan.priceCents,
          }
        : null,
      quota,
      daysLeftInTrial,
      daysUntilSuspension,
    };
  }

  @Patch('plan')
  @ApiOperation({
    summary:
      'Trocar de plano (vale a partir do pr\u00f3ximo ciclo de cobran\u00e7a)',
  })
  async changePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePlanDto,
  ) {
    const sub = await this.subscriptionService.changePlan(
      user.userId,
      dto.planId,
    );
    return { id: sub.id, planId: sub.planId, nextPlanId: sub.nextPlanId };
  }

  @Delete()
  @ApiOperation({ summary: 'Cancelar assinatura ao fim do ciclo' })
  async cancel(@CurrentUser() user: AuthenticatedUser) {
    const sub = await this.subscriptionService.cancelAtPeriodEnd(user.userId);
    return {
      id: sub.id,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      currentPeriodEnd: sub.currentPeriodEnd,
    };
  }

  @Post('resume')
  @ApiOperation({ summary: 'Reverter cancelamento agendado' })
  async resume(@CurrentUser() user: AuthenticatedUser) {
    const sub = await this.subscriptionService.resumeSubscription(user.userId);
    return {
      id: sub.id,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    };
  }
}
