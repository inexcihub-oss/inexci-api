import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { SubscriptionRepository } from 'src/database/repositories/subscription.repository';
import { SubscriptionQuotaPeriodRepository } from 'src/database/repositories/subscription-quota-period.repository';
import { SubscriptionStatus } from 'src/database/entities/subscription.entity';
import { SubscriptionQuotaPeriod } from 'src/database/entities/subscription-quota-period.entity';
import { BillingRequiredException } from '../billing.exceptions';

export interface QuotaSnapshot {
  used: number;
  limit: number;
  isUnlimited: boolean;
  remaining: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface ConsumeQuotaOptions {
  manager?: EntityManager;
}

export interface QuotaStatus {
  used: number;
  limit: number;
  isUnlimited: boolean;
  remaining: number | null;
  periodStart: Date;
  periodEnd: Date;
}

@Injectable()
export class QuotaService {
  constructor(
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly quotaPeriodRepo: SubscriptionQuotaPeriodRepository,
  ) {}

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

    if (period.surgeryRequestsLimit === -1) return;

    if (period.surgeryRequestsUsed >= period.surgeryRequestsLimit) {
      throw new BillingRequiredException(
        `Voc\u00ea atingiu o limite de ${period.surgeryRequestsLimit} solicita\u00e7\u00f5es do seu plano neste ciclo. Fa\u00e7a upgrade para continuar.`,
        'quota_exceeded',
      );
    }
  }

  async consumeSurgeryRequest(
    ownerId: string,
    options: ConsumeQuotaOptions = {},
  ): Promise<QuotaSnapshot> {
    const { manager } = options;
    await this.assertCanSendSurgeryRequest(ownerId);

    const subscription = await this.subscriptionRepo.findByOwnerId(ownerId);
    if (!subscription) {
      throw new NotFoundException('Assinatura n\u00e3o encontrada');
    }

    const period = await this.quotaPeriodRepo.findCurrentForSubscription(
      subscription.id,
      new Date(),
      manager,
    );
    if (!period) {
      throw new BillingRequiredException(
        'Sua assinatura n\u00e3o tem um per\u00edodo de cota ativo',
        'subscription_suspended',
      );
    }

    if (period.surgeryRequestsLimit !== -1) {
      const ok = await this.quotaPeriodRepo.tryConsume(period.id, manager);
      if (!ok) {
        throw new BillingRequiredException(
          `Voc\u00ea atingiu o limite de ${period.surgeryRequestsLimit} solicita\u00e7\u00f5es do seu plano neste ciclo.`,
          'quota_exceeded',
        );
      }
    }

    const refreshed = await this.quotaPeriodRepo.findById(period.id, manager);
    return this.toSnapshot(refreshed!);
  }

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

  async getQuotaStatus(ownerId: string): Promise<QuotaStatus | null> {
    const snapshot = await this.getQuotaSnapshot(ownerId);
    if (!snapshot) return null;

    return {
      used: snapshot.used,
      limit: snapshot.limit,
      isUnlimited: snapshot.isUnlimited,
      remaining: snapshot.isUnlimited ? null : snapshot.remaining,
      periodStart: snapshot.periodStart,
      periodEnd: snapshot.periodEnd,
    };
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
