import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import { SubscriptionRepository } from 'src/database/repositories/subscription.repository';
import { PaymentMethodRepository } from 'src/database/repositories/payment-method.repository';
import { SubscriptionPlanRepository } from 'src/database/repositories/subscription-plan.repository';
import { SubscriptionStatus } from 'src/database/entities/subscription.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { MailService } from 'src/shared/mail/mail.service';

import { SubscriptionService } from './subscription.service';

/**
 * Cron di\u00e1rio (07:00 America/Sao_Paulo) que cobre todos os cen\u00e1rios
 * temporais do ciclo de vida da assinatura:
 *
 * 1. Lembretes de fim de trial (7, 3, 1 dia antes do `trialEndsAt`).
 * 2. Trial expirado SEM cart\u00e3o cadastrado \u2192 SUSPENDED.
 *    (Trial expirado COM cart\u00e3o segue o webhook do gateway, sem a\u00e7\u00e3o aqui.)
 * 3. Per\u00edodo de gra\u00e7a (PAST_DUE) expirado \u2192 SUSPENDED.
 * 4. cancel_at_period_end com per\u00edodo expirado \u2192 CANCELED.
 *
 * Importante: este cron \u00e9 idempotente. Cada cen\u00e1rio s\u00f3 dispara uma a\u00e7\u00e3o
 * por subscription por dia (controlado pela transi\u00e7\u00e3o de status).
 */
@Injectable()
export class BillingCronService {
  private readonly logger = new Logger(BillingCronService.name);

  constructor(
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly paymentMethodRepo: PaymentMethodRepository,
    private readonly _planRepo: SubscriptionPlanRepository,
    private readonly userRepo: UserRepository,
    private readonly mailService: MailService,
    private readonly subscriptionService: SubscriptionService,
    private readonly config: ConfigService,
  ) {}

  @Cron('30 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async runDaily() {
    this.logger.log('[BillingCron] iniciando ciclo di\u00e1rio');
    try {
      await this.handleTrialReminders();
    } catch (err) {
      this.logger.error(
        `[BillingCron] trial reminders: ${err instanceof Error ? err.message : err}`,
      );
    }
    try {
      await this.handleExpiredTrialsWithoutCard();
    } catch (err) {
      this.logger.error(
        `[BillingCron] expired trials: ${err instanceof Error ? err.message : err}`,
      );
    }
    try {
      await this.handleExpiredGracePeriod();
    } catch (err) {
      this.logger.error(
        `[BillingCron] grace period: ${err instanceof Error ? err.message : err}`,
      );
    }
    try {
      await this.handleScheduledCancellations();
    } catch (err) {
      this.logger.error(
        `[BillingCron] scheduled cancellations: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ───── 1. Lembretes de fim de trial ─────

  private async handleTrialReminders() {
    const reminderDays = this.config
      .get<string>('BILLING_TRIAL_REMINDER_DAYS', '7,3,1')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);

    const now = new Date();
    for (const days of reminderDays) {
      const target = this.addDays(now, days);
      const lower = this.startOfDay(target);
      const upper = this.endOfDay(target);

      const expiringTrials =
        await this.subscriptionRepo.findExpiringTrialsBefore(upper);
      for (const sub of expiringTrials) {
        if (
          sub.status !== SubscriptionStatus.TRIALING ||
          !sub.trialEndsAt ||
          sub.trialEndsAt < lower ||
          sub.trialEndsAt > upper
        ) {
          continue;
        }
        const owner = await this.userRepo.findOne({ id: sub.ownerId });
        if (!owner) continue;
        try {
          await this.mailService.send(
            'generic-notification',
            owner.email,
            `Seu trial termina em ${days} ${days === 1 ? 'dia' : 'dias'}`,
            {
              userName: owner.name,
              title: `Seu per\u00edodo de teste termina em ${days} ${days === 1 ? 'dia' : 'dias'}`,
              body: 'Cadastre um cart\u00e3o para n\u00e3o perder o acesso \u00e0 cria\u00e7\u00e3o de novas solicita\u00e7\u00f5es cir\u00fargicas. Sem cart\u00e3o, sua conta fica em modo somente leitura ao final do per\u00edodo.',
              ctaLabel: 'Configurar pagamento',
              ctaUrl: `${this.config.get<string>('DASHBOARD_URL', '')}/configuracoes?tab=plan`,
            },
          );
        } catch (err) {
          this.logger.warn(
            `Falha ao enviar lembrete de trial para owner=${owner.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }
  }

  // ───── 2. Trial expirado sem cart\u00e3o ─────

  private async handleExpiredTrialsWithoutCard() {
    const now = new Date();
    const expired = await this.subscriptionRepo.findExpiringTrialsBefore(now);

    for (const sub of expired) {
      if (sub.status !== SubscriptionStatus.TRIALING) continue;

      const cards = await this.paymentMethodRepo.findByOwnerId(sub.ownerId);
      if (cards.length > 0) {
        // Trial encerra mas a subscription do gateway j\u00e1 foi criada quando
        // o cart\u00e3o entrou; o webhook PAYMENT_CONFIRMED ativa.
        continue;
      }

      await this.subscriptionService.suspend(sub.id, now);
      const owner = await this.userRepo.findOne({ id: sub.ownerId });
      if (owner) {
        try {
          await this.mailService.send(
            'generic-notification',
            owner.email,
            'Seu per\u00edodo de teste terminou',
            {
              userName: owner.name,
              title: 'Seu per\u00edodo de teste terminou',
              body: 'Sua conta entrou em modo somente leitura. Cadastre um cart\u00e3o de cr\u00e9dito para reativar a cria\u00e7\u00e3o de novas solicita\u00e7\u00f5es cir\u00fargicas.',
              ctaLabel: 'Reativar conta',
              ctaUrl: `${this.config.get<string>('DASHBOARD_URL', '')}/configuracoes?tab=plan`,
            },
          );
        } catch {
          // ignora falha de email
        }
      }
    }
  }

  // ───── 3. Per\u00edodo de gra\u00e7a expirado ─────

  private async handleExpiredGracePeriod() {
    const grace = Number(
      this.config.get<number>('BILLING_GRACE_PERIOD_DAYS', 7),
    );
    const cutoff = this.addDays(new Date(), -grace);

    const overdue = await this.subscriptionRepo.findPastDueOlderThan(cutoff);
    for (const sub of overdue) {
      await this.subscriptionService.suspend(sub.id, new Date());
      const owner = await this.userRepo.findOne({ id: sub.ownerId });
      if (owner) {
        try {
          await this.mailService.send(
            'generic-notification',
            owner.email,
            'Sua assinatura foi suspensa',
            {
              userName: owner.name,
              title: 'Sua assinatura foi suspensa',
              body: 'Tentamos cobrar sua assinatura por 7 dias sem sucesso. Sua conta foi colocada em modo somente leitura. Atualize o m\u00e9todo de pagamento para reativar.',
              ctaLabel: 'Atualizar pagamento',
              ctaUrl: `${this.config.get<string>('DASHBOARD_URL', '')}/configuracoes?tab=plan`,
            },
          );
        } catch {
          // ignora
        }
      }
    }
  }

  // ───── 4. Cancelamentos agendados ─────

  private async handleScheduledCancellations() {
    const due = await this.subscriptionRepo.findCancelAtPeriodEndDue(
      new Date(),
    );
    for (const sub of due) {
      await this.subscriptionService.cancelImmediately(sub.id);
    }
  }

  // ───── helpers ─────

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  private endOfDay(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(23, 59, 59, 999);
    return d;
  }
}
