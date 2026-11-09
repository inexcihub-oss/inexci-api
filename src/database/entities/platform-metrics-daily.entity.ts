import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type PlatformMetricsBySituation = Record<string, number>;

@Entity('platform_metrics_daily')
export class PlatformMetricsDaily {
  @PrimaryColumn({ type: 'date' })
  day: string;

  @Column({ name: 'accounts_total', type: 'int' })
  accountsTotal: number;

  @Column({ name: 'accounts_by_situation', type: 'jsonb', nullable: true })
  accountsBySituation: PlatformMetricsBySituation | null;

  @Column({ name: 'mrr_cents', type: 'int' })
  mrrCents: number;

  @Column({ name: 'paying_accounts', type: 'int' })
  payingAccounts: number;

  @Column({ name: 'trial_accounts', type: 'int', nullable: true })
  trialAccounts: number | null;

  @Column({ name: 'new_accounts', type: 'int' })
  newAccounts: number;

  @Column({ name: 'canceled_accounts', type: 'int' })
  canceledAccounts: number;

  @Column({ name: 'active_accounts_7d', type: 'int', nullable: true })
  activeAccounts7d: number | null;

  @Column({ name: 'active_accounts_30d', type: 'int', nullable: true })
  activeAccounts30d: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
