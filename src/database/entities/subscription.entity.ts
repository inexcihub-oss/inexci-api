import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';

import { User } from './user.entity';
import { SubscriptionPlan } from './subscription-plan.entity';
import type { SubscriptionQuotaPeriod } from './subscription-quota-period.entity';

/**
 * Status do ciclo de vida da assinatura.
 *
 * - TRIALING: período de avaliação gratuita (30 dias). Não requer
 *   método de pagamento. `trialEndsAt` define o fim.
 * - ACTIVE: assinatura paga em dia.
 * - PAST_DUE: última cobrança falhou; Stripe está em retry/dunning.
 *   UX continua liberada durante esse período.
 * - SUSPENDED: conta bloqueada para mutar/criar solicitações; permanece
 *   read-only até regularizar via Customer Portal.
 * - CANCELED: cancelada definitivamente.
 */
export enum SubscriptionStatus {
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  SUSPENDED = 'suspended',
  CANCELED = 'canceled',
}

/**
 * Assinatura do tenant (vinculada ao admin/owner).
 *
 * Espelho read-model da Stripe. Fonte da verdade: Stripe.
 * Sincronizado via webhooks (`customer.subscription.*`, `invoice.*`).
 */
@Entity('subscriptions')
@Index('idx_subscriptions_owner_id', ['ownerId'])
@Index('idx_subscriptions_status', ['status'])
@Index('idx_subscriptions_gateway_subscription_id', ['gatewaySubscriptionId'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK para `users.id` do admin dono da conta (ownerId do tenant). */
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: SubscriptionStatus.TRIALING,
  })
  status: SubscriptionStatus;

  // ───── Datas do ciclo ─────

  @Column({ name: 'trial_ends_at', type: 'timestamptz', nullable: true })
  trialEndsAt: Date | null;

  @Column({ name: 'current_period_start', type: 'timestamptz' })
  currentPeriodStart: Date;

  @Column({ name: 'current_period_end', type: 'timestamptz' })
  currentPeriodEnd: Date;

  /** Marca o momento em que a última cobrança falhou (Stripe em dunning). */
  @Column({ name: 'past_due_since', type: 'timestamptz', nullable: true })
  pastDueSince: Date | null;

  /** Quando true, no fim do período a assinatura vira CANCELED (gerenciado pelo Portal). */
  @Column({ name: 'cancel_at_period_end', type: 'boolean', default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ name: 'canceled_at', type: 'timestamptz', nullable: true })
  canceledAt: Date | null;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

  // ───── Referências do gateway ─────

  /** Provider que cuida desta assinatura (stripe). */
  @Column({ name: 'gateway_provider', type: 'varchar', length: 30 })
  gatewayProvider: string;

  @Column({
    name: 'gateway_customer_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  gatewayCustomerId: string | null;

  @Column({
    name: 'gateway_subscription_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  gatewaySubscriptionId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ───── Relações ─────

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @ManyToOne(() => SubscriptionPlan, (p) => p.subscriptions)
  @JoinColumn({ name: 'plan_id' })
  plan: SubscriptionPlan;

  @OneToMany('SubscriptionQuotaPeriod', 'subscription')
  quotaPeriods: SubscriptionQuotaPeriod[];
}
