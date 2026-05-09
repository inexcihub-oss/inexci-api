import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

import { Subscription } from './subscription.entity';

/**
 * Per\u00edodo de cota de uma assinatura.
 *
 * Cada ciclo de cobran\u00e7a possui um registro com o consumo do per\u00edodo
 * (quantas solicita\u00e7\u00f5es foram ENVIADAS para an\u00e1lise). Quando o ciclo
 * vira, um novo registro \u00e9 criado.
 *
 * Concorr\u00eancia: o incremento do contador deve ser feito com `UPDATE ...
 * SET surgery_requests_used = surgery_requests_used + 1 WHERE id = :id AND
 * surgery_requests_used < limit` para garantir atomicidade (rejeita o
 * incremento se a cota j\u00e1 foi atingida).
 */
@Entity('subscription_quota_periods')
@Index('idx_quota_periods_subscription_id', ['subscriptionId'])
@Index(
  'idx_quota_periods_subscription_period',
  ['subscriptionId', 'periodStart'],
  { unique: true },
)
export class SubscriptionQuotaPeriod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId: string;

  @Column({ name: 'period_start', type: 'timestamptz' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'timestamptz' })
  periodEnd: Date;

  /** Snapshot da cota do plano no in\u00edcio do per\u00edodo (-1 = ilimitado). */
  @Column({ name: 'surgery_requests_limit', type: 'int' })
  surgeryRequestsLimit: number;

  @Column({ name: 'surgery_requests_used', type: 'int', default: 0 })
  surgeryRequestsUsed: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Subscription, (s) => s.quotaPeriods, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;
}
