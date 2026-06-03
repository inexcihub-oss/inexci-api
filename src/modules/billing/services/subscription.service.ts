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
import { PaymentMethodRepository } from 'src/database/repositories/payment-method.repository';
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

export interface CardPaymentInfo {
  paymentMethodId: string;
  brand: string;
  last4: string;
  holderName: string;
  expMonth: number;
  expYear: number;
}

/**
 * Orquestrador do ciclo de vida da assinatura.
 *
 * Concentra as regras de negócio:
 * - Criação automática de trial no cadastro.
 * - Criação de subscription no gateway quando o cartão é cadastrado.
 * - Troca de plano (só vale no próximo ciclo — sem proration).
 * - Cancelamento (mantém até o final do ciclo).
 * - Reativação (limpa flag de cancel_at_period_end ou cria nova).
 * - Transições de status disparadas pelo cron e pelos webhooks.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly planRepo: SubscriptionPlanRepository,
    private readonly quotaPeriodRepo: SubscriptionQuotaPeriodRepository,
    private readonly paymentMethodRepo: PaymentMethodRepository,
    private readonly userRepo: UserRepository,
    private readonly config: ConfigService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  // ───── Criação (chamado no register) ─────

  /**
   * Cria assinatura inicial — pode ser TRIALING (30 dias grátis) ou ACTIVE com cartão.
   *
   * Se `planSlug` for fornecido e for um plano com `isTrialDefault=true`, cria trial.
   * Caso contrário, se houver `paymentInfo`, cria assinatura paga imediatamente.
   * Se nenhum plano for especificado, usa o plano default com trial.
   */
  async createInitialSubscription(
    ownerId: string,
    planSlug?: string,
    paymentInfo?: CardPaymentInfo,
  ): Promise<Subscription> {
    const plan = await this.resolveInitialPlan(planSlug);

    if (plan.isTrialDefault) {
      return this.createTrialSubscription(ownerId, plan.slug);
    }

    if (!paymentInfo) {
      throw new BadRequestException(
        'Dados de pagamento são obrigatórios para planos pagos',
      );
    }

    return this.createPaidSubscription(ownerId, plan, paymentInfo);
  }

  /**
   * Cria assinatura TRIALING para um novo admin/owner.
   *
   * Se `planSlug` for fornecido, o trial é ancorado nesse plano (ou seja,
   * a cota durante o trial é a do plano escolhido e a primeira cobrança
   * após o trial será desse mesmo plano). Caso contrário, usa o plano
   * marcado como `is_trial_default = true`.
   *
   * Não cria nada no gateway ainda (o gateway só entra em cena quando
   * o admin cadastra o cartão).
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

  private async createPaidSubscription(
    ownerId: string,
    plan: SubscriptionPlan,
    paymentInfo: CardPaymentInfo,
  ): Promise<Subscription> {
    const existing = await this.subscriptionRepo.findByOwnerId(ownerId);
    if (existing) {
      this.logger.warn(
        `[createPaid] já existe subscription para owner ${ownerId} — ignorando`,
      );
      return existing;
    }

    const user = await this.userRepo.findOne({ id: ownerId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const customer = await this.gateway.createCustomer({
      ownerId,
      name: user.name,
      email: user.email,
      phone: user.phone || null,
    });

    const tokenized = await this.gateway.tokenizeCard({
      customerId: customer.id,
      paymentMethodId: paymentInfo.paymentMethodId,
      brand: paymentInfo.brand,
      last4: paymentInfo.last4,
      holderName: paymentInfo.holderName,
      expMonth: paymentInfo.expMonth,
      expYear: paymentInfo.expYear,
    });

    const now = new Date();
    const periodEnd = this.addDays(
      now,
      plan.billingPeriod === 'YEARLY' ? 365 : 30,
    );

    const subscription = await this.subscriptionRepo.create({
      ownerId,
      planId: plan.id,
      status: SubscriptionStatus.ACTIVE,
      trialEndsAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      gatewayProvider: this.gateway.providerId,
      gatewayCustomerId: customer.id,
    });

    const gatewaySub = await this.gateway.createSubscription({
      customerId: customer.id,
      paymentMethodToken: tokenized.token,
      amountCents: plan.priceCents,
      cycle: plan.billingPeriod,
      nextDueDate: now,
      description: `Assinatura ${plan.name} — Inexci`,
      externalReference: subscription.id,
    });

    const savedPM = await this.paymentMethodRepo.create({
      ownerId,
      gatewayProvider: this.gateway.providerId,
      gatewayToken: tokenized.token,
      gatewayCustomerId: customer.id,
      brand: tokenized.brand,
      last4: tokenized.last4,
      holderName: tokenized.holderName,
      expMonth: tokenized.expMonth,
      expYear: tokenized.expYear,
      isDefault: true,
    });

    await this.subscriptionRepo.update(subscription.id, {
      gatewaySubscriptionId: gatewaySub.id,
      defaultPaymentMethodId: savedPM.id,
    });

    await this.quotaPeriodRepo.create({
      subscriptionId: subscription.id,
      periodStart: now,
      periodEnd: periodEnd,
      surgeryRequestsLimit: plan.surgeryRequestQuota,
      surgeryRequestsUsed: 0,
    });

    this.logger.log(
      `Assinatura paga criada para owner=${ownerId} plano=${plan.slug}`,
    );
    return (await this.subscriptionRepo.findOne({ id: subscription.id }))!;
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
      const grace = Number(
        this.config.get<number>('BILLING_GRACE_PERIOD_DAYS', 7),
      );
      const suspensionDate = this.addDays(subscription.pastDueSince, grace);
      daysUntilSuspension = Math.max(
        0,
        Math.ceil(
          (suspensionDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      );
    }

    return { subscription, daysLeftInTrial, daysUntilSuspension };
  }

  // ───── Mudanças de estado ─────

  /**
   * Agenda troca de plano para o próximo ciclo.
   * Segue a regra "next_cycle" — a troca só entra em vigor no fim do
   * período atual; o gateway recebe o update no momento da renovação.
   */
  async changePlan(userId: string, planId: string): Promise<Subscription> {
    const owner = await this.assertOwner(userId);
    const subscription = await this.subscriptionRepo.findByOwnerId(owner.id);
    if (!subscription) {
      throw new NotFoundException('Assinatura não encontrada');
    }
    if (subscription.status === SubscriptionStatus.CANCELED) {
      throw new BadRequestException(
        'Assinatura cancelada. Crie uma nova assinatura.',
      );
    }
    const plan = await this.planRepo.findOne({ id: planId });
    if (!plan || !plan.isActive) {
      throw new NotFoundException('Plano não encontrado ou inativo');
    }

    if (subscription.planId === planId) {
      // Cancela uma troca pendente, se existia
      await this.subscriptionRepo.update(subscription.id, { nextPlanId: null });
      return (await this.subscriptionRepo.findOne({ id: subscription.id }))!;
    }

    await this.subscriptionRepo.update(subscription.id, { nextPlanId: planId });
    this.logger.log(
      `Plano agendado para troca: subscription=${subscription.id} novoPlano=${plan.slug}`,
    );
    return (await this.subscriptionRepo.findOne({ id: subscription.id }))!;
  }

  /**
   * Marca cancelamento ao fim do ciclo. A conta continua ativa até lá.
   * No gateway, o cancelamento real só acontece quando o cron de fim de
   * período executa.
   */
  async cancelAtPeriodEnd(userId: string): Promise<Subscription> {
    const owner = await this.assertOwner(userId);
    const subscription = await this.subscriptionRepo.findByOwnerId(owner.id);
    if (!subscription) {
      throw new NotFoundException('Assinatura não encontrada');
    }
    if (
      subscription.status === SubscriptionStatus.CANCELED ||
      subscription.cancelAtPeriodEnd
    ) {
      return subscription;
    }
    await this.subscriptionRepo.update(subscription.id, {
      cancelAtPeriodEnd: true,
    });
    return (await this.subscriptionRepo.findOne({ id: subscription.id }))!;
  }

  /** Reverte um cancelamento agendado (enquanto ainda no período atual). */
  async resumeSubscription(userId: string): Promise<Subscription> {
    const owner = await this.assertOwner(userId);
    const subscription = await this.subscriptionRepo.findByOwnerId(owner.id);
    if (!subscription) {
      throw new NotFoundException('Assinatura não encontrada');
    }
    if (subscription.status === SubscriptionStatus.CANCELED) {
      throw new BadRequestException('Assinatura já cancelada. Crie uma nova.');
    }
    await this.subscriptionRepo.update(subscription.id, {
      cancelAtPeriodEnd: false,
    });
    return (await this.subscriptionRepo.findOne({ id: subscription.id }))!;
  }

  // ───── Hooks chamados pelo PaymentMethodService ─────

  /**
   * Quando o admin cadastra o primeiro cartão durante o trial, cria a
   * subscription no gateway com `nextDueDate = trialEndsAt`. Isso faz o
   * Stripe iniciar a cobrança imediatamente após o trial.
   *
   * Se a subscription já estava ACTIVE/PAST_DUE/SUSPENDED, apenas atualiza
   * o cartão associado.
   */
  async onPaymentMethodAdded(params: {
    ownerId: string;
    paymentMethodId: string;
    paymentMethodToken: string;
    gatewayCustomerId: string;
  }): Promise<void> {
    const subscription = await this.subscriptionRepo.findByOwnerId(
      params.ownerId,
    );
    if (!subscription) return;

    const plan = await this.planRepo.findOne({ id: subscription.planId });
    if (!plan) return;

    if (subscription.status === SubscriptionStatus.TRIALING) {
      // Cria subscription no gateway com primeira cobrança no fim do trial
      const nextDue = subscription.trialEndsAt ?? new Date();
      const gatewaySub = await this.gateway.createSubscription({
        customerId: params.gatewayCustomerId,
        paymentMethodToken: params.paymentMethodToken,
        amountCents: plan.priceCents,
        cycle: plan.billingPeriod,
        nextDueDate: nextDue,
        description: `Assinatura ${plan.name} — Inexci`,
        externalReference: subscription.id,
      });

      await this.subscriptionRepo.update(subscription.id, {
        gatewayCustomerId: params.gatewayCustomerId,
        gatewaySubscriptionId: gatewaySub.id,
        defaultPaymentMethodId: params.paymentMethodId,
      });
      return;
    }

    if (subscription.status === SubscriptionStatus.SUSPENDED) {
      // Sai da suspensão após cadastro de cartão (cobrança imediata
      // é disparada pelo gateway na próxima nextDueDate).
      const nextDue = new Date();
      let gatewaySubId = subscription.gatewaySubscriptionId;
      if (!gatewaySubId) {
        const gatewaySub = await this.gateway.createSubscription({
          customerId: params.gatewayCustomerId,
          paymentMethodToken: params.paymentMethodToken,
          amountCents: plan.priceCents,
          cycle: plan.billingPeriod,
          nextDueDate: nextDue,
          description: `Assinatura ${plan.name} — Inexci`,
          externalReference: subscription.id,
        });
        gatewaySubId = gatewaySub.id;
      }
      await this.subscriptionRepo.update(subscription.id, {
        status: SubscriptionStatus.ACTIVE,
        suspendedAt: null,
        pastDueSince: null,
        gatewayCustomerId: params.gatewayCustomerId,
        gatewaySubscriptionId: gatewaySubId,
        defaultPaymentMethodId: params.paymentMethodId,
      });
      return;
    }

    // Caso comum: apenas troca o cartão ativo
    await this.subscriptionRepo.update(subscription.id, {
      gatewayCustomerId: params.gatewayCustomerId,
      defaultPaymentMethodId: params.paymentMethodId,
    });
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
    if (sub.gatewaySubscriptionId) {
      try {
        await this.gateway.cancelSubscription(sub.gatewaySubscriptionId, {
          atPeriodEnd: false,
        });
      } catch (err) {
        this.logger.warn(
          `Falha ao cancelar no gateway subscription=${sub.gatewaySubscriptionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await this.subscriptionRepo.update(subscriptionId, {
      status: SubscriptionStatus.CANCELED,
      canceledAt: new Date(),
      cancelAtPeriodEnd: false,
    });
  }

  /**
   * Avança o período de cobrança (chamado quando uma fatura é paga
   * com sucesso). Se houver `nextPlanId`, ativa a troca de plano agendada.
   */
  async advanceBillingPeriod(subscriptionId: string): Promise<void> {
    const sub = await this.subscriptionRepo.findOne({ id: subscriptionId });
    if (!sub) return;

    const planId = sub.nextPlanId ?? sub.planId;
    const plan = await this.planRepo.findOne({ id: planId });
    if (!plan) return;

    const periodStart = sub.currentPeriodEnd;
    const periodEnd = this.addBillingPeriod(periodStart, plan.billingPeriod);

    await this.subscriptionRepo.update(subscriptionId, {
      status: SubscriptionStatus.ACTIVE,
      planId: plan.id,
      nextPlanId: null,
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

  // ───── Helpers ─────

  /**
   * Apenas o admin (owner = self) pode contratar/alterar o plano. Colaboradores
   * recebem 403.
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
}
