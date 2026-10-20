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

export type BillingPeriod = 'MONTHLY' | 'YEARLY';

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

  @Column({ name: 'surgery_request_quota', type: 'int' })
  surgeryRequestQuota: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'is_trial_default', type: 'boolean', default: false })
  isTrialDefault: boolean;

  @Column({
    name: 'gateway_price_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
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
