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
import type { Invoice } from './invoice.entity';
import type { SubscriptionQuotaPeriod } from './subscription-quota-period.entity';

/**
 * Status do ciclo de vida da assinatura.
 *
 * - TRIALING: per\u00edodo de avalia\u00e7\u00e3o gratuita (30 dias). N\u00e3o requer
 *   m\u00e9todo de pagamento. `trialEndsAt` define o fim.
 * - ACTIVE: assinatura paga em dia.
 * - PAST_DUE: \u00faltima cobran\u00e7a falhou; conta em per\u00edodo de gra\u00e7a (7 dias)
 *   antes de virar SUSPENDED. UX continua liberada nesse per\u00edodo.
 * - SUSPENDED: conta bloqueada para mutar/criar solicita\u00e7\u00f5es; permanece
 *   read-only at\u00e9 regularizar (cadastrar cart\u00e3o ou pagar fatura pendente).
 *   Aplica-se a: trial expirado sem cart\u00e3o, gra\u00e7a expirada sem pagamento.
 * - CANCELED: cancelada definitivamente. Conta read-only sem possibilidade
 *   de reativa\u00e7\u00e3o (precisa criar nova assinatura).
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
 * Cada conta (`User` admin com `ownerId = id`) tem **uma** assinatura ativa.
 * Quando cancelada, uma nova \u00e9 criada (hist\u00f3rico via timestamps).
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

  /**
   * Pr\u00f3ximo plano agendado para entrar em vigor no fim do ciclo atual.
   * Usado quando o admin troca de plano (regra de neg\u00f3cio: troca s\u00f3 vale
   * no pr\u00f3ximo ciclo de cobran\u00e7a, sem proration).
   */
  @Column({ name: 'next_plan_id', type: 'uuid', nullable: true })
  nextPlanId: string | null;

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

  /**
   * Marca o momento em que a \u00faltima cobran\u00e7a falhou. Junto com
   * `BILLING_GRACE_PERIOD_DAYS` define quando a conta vai para SUSPENDED.
   */
  @Column({ name: 'past_due_since', type: 'timestamptz', nullable: true })
  pastDueSince: Date | null;

  /** Quando true, no fim do per\u00edodo a assinatura vira CANCELED. */
  @Column({ name: 'cancel_at_period_end', type: 'boolean', default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ name: 'canceled_at', type: 'timestamptz', nullable: true })
  canceledAt: Date | null;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

  // ───── Refer\u00eancias do gateway ─────

  /** Provider que cuida desta assinatura (asaas, stripe, ...). */
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

  /**
   * ID do payment_method ativo (cart\u00e3o tokenizado) que o gateway usar\u00e1
   * para a pr\u00f3xima cobran\u00e7a. Pode ser null durante o trial.
   */
  @Column({
    name: 'default_payment_method_id',
    type: 'uuid',
    nullable: true,
  })
  defaultPaymentMethodId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ───── Rela\u00e7\u00f5es ─────

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @ManyToOne(() => SubscriptionPlan, (p) => p.subscriptions)
  @JoinColumn({ name: 'plan_id' })
  plan: SubscriptionPlan;

  @ManyToOne(() => SubscriptionPlan)
  @JoinColumn({ name: 'next_plan_id' })
  nextPlan: SubscriptionPlan | null;

  @OneToMany('Invoice', 'subscription')
  invoices: Invoice[];

  @OneToMany('SubscriptionQuotaPeriod', 'subscription')
  quotaPeriods: SubscriptionQuotaPeriod[];
}
