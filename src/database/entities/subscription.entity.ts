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

export enum SubscriptionStatus {
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  SUSPENDED = 'suspended',
  CANCELED = 'canceled',
  INTERNAL = 'internal',
}

export type SubscriptionDiscountDuration = 'once' | 'repeating' | 'forever';

@Entity('subscriptions')
@Index('idx_subscriptions_owner_id', ['ownerId'])
@Index('idx_subscriptions_status', ['status'])
@Index('idx_subscriptions_gateway_subscription_id', ['gatewaySubscriptionId'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  @Column({ name: 'trial_ends_at', type: 'timestamptz', nullable: true })
  trialEndsAt: Date | null;

  @Column({ name: 'current_period_start', type: 'timestamptz' })
  currentPeriodStart: Date;

  @Column({ name: 'current_period_end', type: 'timestamptz' })
  currentPeriodEnd: Date;

  @Column({ name: 'past_due_since', type: 'timestamptz', nullable: true })
  pastDueSince: Date | null;

  @Column({ name: 'cancel_at_period_end', type: 'boolean', default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ name: 'canceled_at', type: 'timestamptz', nullable: true })
  canceledAt: Date | null;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

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

  @Column({ name: 'internal_access_granted_by', type: 'uuid', nullable: true })
  internalAccessGrantedBy: string | null;

  @Column({
    name: 'internal_access_granted_at',
    type: 'timestamptz',
    nullable: true,
  })
  internalAccessGrantedAt: Date | null;

  @Column({
    name: 'discount_percent_off',
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: number | null | undefined) => value,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  discountPercentOff: number | null;

  @Column({ name: 'discount_amount_off_cents', type: 'int', nullable: true })
  discountAmountOffCents: number | null;

  @Column({
    name: 'discount_duration',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  discountDuration: SubscriptionDiscountDuration | null;

  @Column({ name: 'discount_ends_at', type: 'timestamptz', nullable: true })
  discountEndsAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @ManyToOne(() => SubscriptionPlan, (p) => p.subscriptions)
  @JoinColumn({ name: 'plan_id' })
  plan: SubscriptionPlan;

  @OneToMany('SubscriptionQuotaPeriod', 'subscription')
  quotaPeriods: SubscriptionQuotaPeriod[];
}
