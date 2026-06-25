import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import type { Subscription } from './subscription.entity';

/**
 * Periodicidade da cobran\u00e7a do plano.
 * - MONTHLY: cobrado a cada 30 dias.
 * - YEARLY: cobrado anualmente (12 meses).
 */
export type BillingPeriod = 'MONTHLY' | 'YEARLY';

/**
 * Plano de assinatura.
 *
 * Modelo de cota: cada plano define quantas solicita\u00e7\u00f5es cir\u00fargicas a conta
 * pode ENVIAR para an\u00e1lise no ciclo (transi\u00e7\u00e3o PENDING \u2192 SENT).
 *
 * - Rascunhos (PENDING) n\u00e3o consomem cota.
 * - O reset acontece no fim do ciclo de cobran\u00e7a da assinatura, n\u00e3o
 *   no in\u00edcio do m\u00eas calend\u00e1rio.
 * - `surgeryRequestQuota = -1` representa "ilimitado".
 *
 * O plano padr\u00e3o atribu\u00eddo no cadastro (trial autom\u00e1tico de 30 dias)
 * \u00e9 marcado por `isTrialDefault = true`.
 */
@Entity('subscription_plans')
@Index('idx_subscription_plans_slug', ['slug'], { unique: true })
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 60 })
  slug: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'price_cents', type: 'int', default: 0 })
  priceCents: number;

  @Column({ type: 'varchar', length: 3, default: 'BRL' })
  currency: string;

  @Column({
    name: 'billing_period',
    type: 'varchar',
    length: 20,
    default: 'MONTHLY',
  })
  billingPeriod: BillingPeriod;

  /**
   * Quantidade m\u00e1xima de solicita\u00e7\u00f5es enviadas por ciclo.
   * Use -1 para "ilimitado".
   */
  @Column({ name: 'surgery_request_quota', type: 'int' })
  surgeryRequestQuota: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'is_trial_default', type: 'boolean', default: false })
  isTrialDefault: boolean;

  /**
   * Price ID estável da Stripe (ex.: price_xxx).
   * Null para planos sem cobrança direta (enterprise = "fale conosco").
   * Populado via `yarn seed:prices` após configurar STRIPE_PRICE_* no .env.
   */
  @Column({ name: 'gateway_price_id', type: 'varchar', length: 100, nullable: true })
  gatewayPriceId: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany('Subscription', 'plan')
  subscriptions: Subscription[];
}
