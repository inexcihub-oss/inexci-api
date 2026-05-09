import { Injectable, NotFoundException } from '@nestjs/common';

import { SubscriptionRepository } from 'src/database/repositories/subscription.repository';
import { SubscriptionQuotaPeriodRepository } from 'src/database/repositories/subscription-quota-period.repository';
import { SubscriptionStatus } from 'src/database/entities/subscription.entity';
import { SubscriptionQuotaPeriod } from 'src/database/entities/subscription-quota-period.entity';
import { BillingRequiredException } from '../billing.exceptions';

export interface QuotaSnapshot {
  used: number;
  limit: number;
  /** -1 = ilimitado. */
  isUnlimited: boolean;
  remaining: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Servi\u00e7o respons\u00e1vel pela contagem e enforcement de cota mensal de
 * solicita\u00e7\u00f5es cir\u00fargicas.
 *
 * A unidade de cota \u00e9 a transi\u00e7\u00e3o PENDING \u2192 SENT (ENVIO para an\u00e1lise).
 * Rascunhos (PENDING) n\u00e3o consomem cota; apenas o envio efetivo consome.
 *
 * O reset acontece no fim do ciclo de cobran\u00e7a da assinatura (n\u00e3o no
 * m\u00eas calend\u00e1rio).
 */
@Injectable()
export class QuotaService {
  constructor(
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly quotaPeriodRepo: SubscriptionQuotaPeriodRepository,
  ) {}

  /**
   * Garante que o owner pode ENVIAR uma nova solicita\u00e7\u00e3o cir\u00fargica.
   * Lan\u00e7a se a assinatura estiver suspensa, cancelada ou se a cota foi
   * atingida.
   */
  async assertCanSendSurgeryRequest(ownerId: string): Promise<void> {
    const subscription = await this.subscriptionRepo.findByOwnerId(ownerId);
    if (!subscription) {
      throw new NotFoundException(
        'Assinatura n\u00e3o encontrada. Contate o suporte.',
      );
    }

    if (subscription.status === SubscriptionStatus.SUSPENDED) {
      throw new BillingRequiredException(
        'Sua assinatura est\u00e1 suspensa. Cadastre um m\u00e9todo de pagamento ou regularize sua fatura para continuar criando solicita\u00e7\u00f5es.',
        'subscription_suspended',
      );
    }

    if (subscription.status === SubscriptionStatus.CANCELED) {
      throw new BillingRequiredException(
        'Sua assinatura est\u00e1 cancelada. Contrate um plano para continuar criando solicita\u00e7\u00f5es.',
        'subscription_canceled',
      );
    }

    const period = await this.quotaPeriodRepo.findCurrentForSubscription(
      subscription.id,
      new Date(),
    );
    if (!period) {
      throw new BillingRequiredException(
        'Sua assinatura n\u00e3o tem um per\u00edodo de cota ativo. Contate o suporte.',
        'subscription_suspended',
      );
    }

    if (period.surgeryRequestsLimit === -1) return; // ilimitado

    if (period.surgeryRequestsUsed >= period.surgeryRequestsLimit) {
      throw new BillingRequiredException(
        `Voc\u00ea atingiu o limite de ${period.surgeryRequestsLimit} solicita\u00e7\u00f5es do seu plano neste ciclo. Fa\u00e7a upgrade para continuar.`,
        'quota_exceeded',
      );
    }
  }

  /**
   * Consome 1 unidade da cota corrente. Combina valida\u00e7\u00e3o + UPDATE
   * condicional at\u00f4mico para evitar race conditions sob concorr\u00eancia.
   *
   * Retorna o snapshot p\u00f3s-consumo. Lan\u00e7a se n\u00e3o foi poss\u00edvel consumir.
   */
  async consumeSurgeryRequest(ownerId: string): Promise<QuotaSnapshot> {
    await this.assertCanSendSurgeryRequest(ownerId);

    const subscription = await this.subscriptionRepo.findByOwnerId(ownerId);
    if (!subscription) {
      throw new NotFoundException('Assinatura n\u00e3o encontrada');
    }

    const period = await this.quotaPeriodRepo.findCurrentForSubscription(
      subscription.id,
      new Date(),
    );
    if (!period) {
      throw new BillingRequiredException(
        'Sua assinatura n\u00e3o tem um per\u00edodo de cota ativo',
        'subscription_suspended',
      );
    }

    if (period.surgeryRequestsLimit !== -1) {
      const ok = await this.quotaPeriodRepo.tryConsume(period.id);
      if (!ok) {
        // Outro request consumiu a \u00faltima unidade entre o assert e o
        // consume. Refletimos a quota saturada como erro.
        throw new BillingRequiredException(
          `Voc\u00ea atingiu o limite de ${period.surgeryRequestsLimit} solicita\u00e7\u00f5es do seu plano neste ciclo.`,
          'quota_exceeded',
        );
      }
    }

    const refreshed = await this.quotaPeriodRepo.findOne({ id: period.id });
    return this.toSnapshot(refreshed!);
  }

  /** Snapshot de leitura da cota corrente. Retorna null se sem assinatura. */
  async getQuotaSnapshot(ownerId: string): Promise<QuotaSnapshot | null> {
    const subscription = await this.subscriptionRepo.findByOwnerId(ownerId);
    if (!subscription) return null;

    const period = await this.quotaPeriodRepo.findCurrentForSubscription(
      subscription.id,
      new Date(),
    );
    if (!period) return null;
    return this.toSnapshot(period);
  }

  private toSnapshot(p: SubscriptionQuotaPeriod): QuotaSnapshot {
    const isUnlimited = p.surgeryRequestsLimit === -1;
    return {
      used: p.surgeryRequestsUsed,
      limit: p.surgeryRequestsLimit,
      isUnlimited,
      remaining: isUnlimited
        ? Number.POSITIVE_INFINITY
        : Math.max(0, p.surgeryRequestsLimit - p.surgeryRequestsUsed),
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
    };
  }
}
