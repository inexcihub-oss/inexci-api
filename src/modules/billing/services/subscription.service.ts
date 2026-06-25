import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SubscriptionRepository } from 'src/database/repositories/subscription.repository';
import { SubscriptionPlanRepository } from 'src/database/repositories/subscription-plan.repository';
import { SubscriptionQuotaPeriodRepository } from 'src/database/repositories/subscription-quota-period.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import {
  Subscription,
  SubscriptionStatus,
} from 'src/database/entities/subscription.entity';
import { SubscriptionPlan } from 'src/database/entities/subscription-plan.entity';

import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from 'src/shared/payment-gateway/payment-gateway.interface';
import {
  GatewaySubscription,
  GatewaySubscriptionStatus,
} from 'src/shared/payment-gateway/payment-gateway.types';

/**
 * Orquestrador do ciclo de vida da assinatura.
 *
 * Modelo Stripe Checkout + Customer Portal:
 * - Cadastro cria trial local leve (sem gateway).
 * - Pagamento, troca de plano, cancelamento e cartão são gerenciados
 *   pelo Customer Portal da Stripe.
 * - Transições de status vêm exclusivamente de webhooks Stripe.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly planRepo: SubscriptionPlanRepository,
    private readonly quotaPeriodRepo: SubscriptionQuotaPeriodRepository,
    private readonly userRepo: UserRepository,
    private readonly config: ConfigService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  // ───── Criação (chamado no register) ─────

  /**
   * Cria assinatura inicial em TRIALING.
   * Sem gateway — o Checkout só é acionado quando o admin decide assinar.
   */
  async createInitialSubscription(
    ownerId: string,
    planSlug?: string,
  ): Promise<Subscription> {
    return this.createTrialSubscription(ownerId, planSlug);
  }

  /**
   * Cria assinatura TRIALING para um novo admin/owner.
   * Idempotente: devolve a existente sem recriar.
   */
  async createTrialSubscription(
    ownerId: string,
    planSlug?: string,
  ): Promise<Subscription> {
    const existing = await this.subscriptionRepo.findByOwnerId(ownerId);
    if (existing) {
      this.logger.warn(
        `[createTrial] já existe subscription para owner ${ownerId} — ignorando`,
      );
      return existing;
    }

    const plan = await this.resolveInitialPlan(planSlug);

    const trialDays = Number(this.config.get<number>('BILLING_TRIAL_DAYS', 30));
    const now = new Date();
    const trialEnd = this.addDays(now, trialDays);

    const subscription = await this.subscriptionRepo.create({
      ownerId,
      planId: plan.id,
      status: SubscriptionStatus.TRIALING,
      trialEndsAt: trialEnd,
      currentPeriodStart: now,
      currentPeriodEnd: trialEnd,
      gatewayProvider: this.gateway.providerId,
    });

    await this.quotaPeriodRepo.create({
      subscriptionId: subscription.id,
      periodStart: now,
      periodEnd: trialEnd,
      surgeryRequestsLimit: plan.surgeryRequestQuota,
      surgeryRequestsUsed: 0,
    });

    this.logger.log(
      `Trial criado para owner=${ownerId} plano=${plan.slug} expira em ${trialEnd.toISOString()}`,
    );
    return subscription;
  }

  private async resolveInitialPlan(
    planSlug: string | undefined,
  ): Promise<SubscriptionPlan> {
    if (planSlug) {
      const plan = await this.planRepo.findBySlug(planSlug);
      if (plan && plan.isActive) return plan;
      this.logger.warn(
        `[createTrial] planSlug="${planSlug}" inválido ou inativo — caindo para o plano default`,
      );
    }
    const trialPlan = await this.planRepo.findTrialDefault();
    if (!trialPlan) {
      throw new NotFoundException(
        'Plano de trial padrão não encontrado. Verifique a tabela subscription_plans.',
      );
    }
    return trialPlan;
  }

  // ───── Leitura ─────

  async getMySubscription(userId: string): Promise<{
    subscription: Subscription;
    daysLeftInTrial: number | null;
    daysUntilSuspension: number | null;
  }> {
    const owner = await this.assertOwner(userId);
    const subscription = await this.subscriptionRepo.findByOwnerId(owner.id);
    if (!subscription) {
      throw new NotFoundException('Assinatura não encontrada');
    }

    const now = new Date();
    let daysLeftInTrial: number | null = null;
    if (
      subscription.status === SubscriptionStatus.TRIALING &&
      subscription.trialEndsAt
    ) {
      daysLeftInTrial = Math.max(
        0,
        Math.ceil(
          (subscription.trialEndsAt.getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );
    }

    let daysUntilSuspension: number | null = null;
    if (
      subscription.status === SubscriptionStatus.PAST_DUE &&
      subscription.pastDueSince
    ) {
      const suspensionDate = this.addDays(subscription.pastDueSince, 7);
      daysUntilSuspension = Math.max(
        0,
        Math.ceil(
          (suspensionDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      );
    }

    return { subscription, daysLeftInTrial, daysUntilSuspension };
  }

  // ───── Hooks chamados pelo cron / webhook handler ─────

  async markPastDue(subscriptionId: string, at: Date): Promise<void> {
    const sub = await this.subscriptionRepo.findOne({ id: subscriptionId });
    if (!sub) return;
    if (sub.status === SubscriptionStatus.PAST_DUE) return;
    await this.subscriptionRepo.update(subscriptionId, {
      status: SubscriptionStatus.PAST_DUE,
      pastDueSince: at,
    });
  }

  async markActive(subscriptionId: string): Promise<void> {
    const sub = await this.subscriptionRepo.findOne({ id: subscriptionId });
    if (!sub) return;
    await this.subscriptionRepo.update(subscriptionId, {
      status: SubscriptionStatus.ACTIVE,
      pastDueSince: null,
      suspendedAt: null,
    });
  }

  async suspend(subscriptionId: string, at: Date): Promise<void> {
    const sub = await this.subscriptionRepo.findOne({ id: subscriptionId });
    if (!sub) return;
    await this.subscriptionRepo.update(subscriptionId, {
      status: SubscriptionStatus.SUSPENDED,
      suspendedAt: at,
    });
  }

  async cancelImmediately(subscriptionId: string): Promise<void> {
    const sub = await this.subscriptionRepo.findOne({ id: subscriptionId });
    if (!sub) return;
    await this.subscriptionRepo.update(subscriptionId, {
      status: SubscriptionStatus.CANCELED,
      canceledAt: new Date(),
      cancelAtPeriodEnd: false,
    });
  }

  /**
   * Avança o período de cobrança e renova a cota.
   * Chamado pelo webhook `invoice.paid` / `customer.subscription.updated`.
   */
  async advanceBillingPeriod(subscriptionId: string): Promise<void> {
    const sub = await this.subscriptionRepo.findOne({ id: subscriptionId });
    if (!sub) return;

    const plan = await this.planRepo.findOne({ id: sub.planId });
    if (!plan) return;

    const periodStart = sub.currentPeriodEnd;
    const periodEnd = this.addBillingPeriod(periodStart, plan.billingPeriod);

    await this.subscriptionRepo.update(subscriptionId, {
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      pastDueSince: null,
    });

    await this.quotaPeriodRepo.create({
      subscriptionId,
      periodStart,
      periodEnd,
      surgeryRequestsLimit: plan.surgeryRequestQuota,
      surgeryRequestsUsed: 0,
    });
  }

  // ───── Checkout / Portal ─────

  /**
   * Cria uma Stripe Checkout Session para o plano selecionado e retorna a URL.
   * O admin é redirecionado para a Stripe para inserir o cartão e confirmar.
   */
  async startCheckout(
    userId: string,
    planId: string,
  ): Promise<{ url: string }> {
    const owner = await this.assertOwner(userId);

    const plan = await this.planRepo.findOne({ id: planId });
    if (!plan || !plan.isActive) {
      throw new NotFoundException('Plano não encontrado');
    }
    if (!plan.gatewayPriceId) {
      throw new BadRequestException(
        'Este plano não está disponível para assinatura direta. Entre em contato.',
      );
    }

    const customerId = await this.ensureGatewayCustomer(owner.id);
    const sub = await this.subscriptionRepo.findByOwnerId(owner.id);

    const dashboardUrl = this.config.get<string>('DASHBOARD_URL', '');
    const session = await this.gateway.createCheckoutSession({
      customerId,
      priceId: plan.gatewayPriceId,
      successUrl: `${dashboardUrl}/configuracoes?tab=plan&checkout=success`,
      cancelUrl: `${dashboardUrl}/configuracoes?tab=plan&checkout=cancel`,
      subscriptionId: sub?.id ?? owner.id,
      trialEnd: sub?.trialEndsAt && sub.trialEndsAt > new Date() ? sub.trialEndsAt : null,
    });

    return { url: session.url };
  }

  /**
   * Cria uma sessão no Stripe Customer Portal para o admin gerenciar a assinatura.
   */
  async openBillingPortal(userId: string): Promise<{ url: string }> {
    const owner = await this.assertOwner(userId);

    const sub = await this.subscriptionRepo.findByOwnerId(owner.id);
    if (!sub?.gatewayCustomerId) {
      throw new BadRequestException(
        'Nenhuma assinatura ativa encontrada. Assine um plano primeiro.',
      );
    }

    const dashboardUrl = this.config.get<string>('DASHBOARD_URL', '');
    const session = await this.gateway.createBillingPortalSession({
      customerId: sub.gatewayCustomerId,
      returnUrl: `${dashboardUrl}/configuracoes?tab=plan`,
    });

    return { url: session.url };
  }

  // ───── Sincronização via webhook ─────

  /**
   * Sincroniza o espelho local com os dados de uma subscription do gateway.
   * Chamado por BillingWebhookService nos eventos subscription.created/updated
   * e checkout.completed.
   */
  async syncFromGatewaySubscription(
    gatewaySub: GatewaySubscription,
  ): Promise<void> {
    const local = await this.subscriptionRepo.findByGatewaySubscriptionId(
      gatewaySub.id,
    );
    if (!local) {
      this.logger.warn(
        `[sync] subscription não encontrada para gateway ID: ${gatewaySub.id}`,
      );
      return;
    }

    const statusMap: Record<GatewaySubscriptionStatus, SubscriptionStatus> = {
      active: SubscriptionStatus.ACTIVE,
      past_due: SubscriptionStatus.PAST_DUE,
      canceled: SubscriptionStatus.CANCELED,
      expired: SubscriptionStatus.CANCELED,
      incomplete: SubscriptionStatus.PAST_DUE,
    };
    const newStatus = statusMap[gatewaySub.status] ?? SubscriptionStatus.PAST_DUE;

    let newPlanId: string | undefined;
    if (gatewaySub.priceId) {
      const plan = await this.planRepo.findOne({
        gatewayPriceId: gatewaySub.priceId,
      } as Parameters<typeof this.planRepo.findOne>[0]);
      if (plan) newPlanId = plan.id;
    }

    const prevPeriodStart = local.currentPeriodStart;

    await this.subscriptionRepo.update(local.id, {
      status: newStatus,
      ...(newPlanId ? { planId: newPlanId } : {}),
      ...(gatewaySub.currentPeriodStart
        ? { currentPeriodStart: gatewaySub.currentPeriodStart }
        : {}),
      ...(gatewaySub.currentPeriodEnd
        ? { currentPeriodEnd: gatewaySub.currentPeriodEnd }
        : {}),
      trialEndsAt: gatewaySub.trialEndsAt,
      cancelAtPeriodEnd: gatewaySub.cancelAtPeriodEnd,
      ...(gatewaySub.canceledAt ? { canceledAt: gatewaySub.canceledAt } : {}),
      ...(newStatus === SubscriptionStatus.ACTIVE
        ? { pastDueSince: null, suspendedAt: null }
        : {}),
    });

    // Renova cota quando o período avança
    const periodAdvanced =
      gatewaySub.currentPeriodStart !== null &&
      prevPeriodStart !== null &&
      gatewaySub.currentPeriodStart.getTime() > prevPeriodStart.getTime();

    if (periodAdvanced && gatewaySub.currentPeriodEnd) {
      const planForQuota = newPlanId
        ? await this.planRepo.findOne({ id: newPlanId })
        : await this.planRepo.findOne({ id: local.planId });

      if (planForQuota) {
        await this.quotaPeriodRepo.create({
          subscriptionId: local.id,
          periodStart: gatewaySub.currentPeriodStart!,
          periodEnd: gatewaySub.currentPeriodEnd,
          surgeryRequestsLimit: planForQuota.surgeryRequestQuota,
          surgeryRequestsUsed: 0,
        });
        this.logger.log(
          `[sync] cota renovada para subscription=${local.id} período=${gatewaySub.currentPeriodStart!.toISOString()}`,
        );
      }
    }
  }

  // ───── Helpers ─────

  /**
   * Apenas o admin (owner = self) pode contratar/alterar o plano.
   */
  private async assertOwner(userId: string) {
    const user = await this.userRepo.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.id !== user.ownerId) {
      throw new ForbiddenException(
        'Apenas o admin da conta pode gerenciar a assinatura',
      );
    }
    return user;
  }

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  private addBillingPeriod(
    date: Date,
    period: SubscriptionPlan['billingPeriod'],
  ): Date {
    const d = new Date(date);
    if (period === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1);
    else d.setUTCMonth(d.getUTCMonth() + 1);
    return d;
  }

  /** Garante/cria Stripe customer para o owner e persiste o ID localmente. */
  async ensureGatewayCustomer(ownerId: string): Promise<string> {
    const sub = await this.subscriptionRepo.findByOwnerId(ownerId);
    if (!sub) throw new NotFoundException('Assinatura não encontrada');
    if (sub.gatewayCustomerId) return sub.gatewayCustomerId;

    const user = await this.userRepo.findOne({ id: ownerId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const customer = await this.gateway.createCustomer({
      ownerId,
      name: user.name,
      email: user.email,
      phone: user.phone || null,
    });

    await this.subscriptionRepo.update(sub.id, {
      gatewayCustomerId: customer.id,
    });

    return customer.id;
  }

  async assertIsOwner(userId: string) {
    return this.assertOwner(userId);
  }

  async findByOwnerId(ownerId: string): Promise<Subscription | null> {
    return this.subscriptionRepo.findByOwnerId(ownerId);
  }
}
