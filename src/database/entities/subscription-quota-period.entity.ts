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
