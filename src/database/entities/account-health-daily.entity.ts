import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

export const ACCOUNT_HEALTH_BANDS = ['healthy', 'attention', 'risk'] as const;

export type AccountHealthBand = (typeof ACCOUNT_HEALTH_BANDS)[number];

export const ACCOUNT_HEALTH_FACTOR_KEYS = [
  'last_seen',
  'usage_drop',
  'trial_ending',
  'quota',
  'errors',
  'delivery_failures',
  'delinquency',
] as const;

export type AccountHealthFactorKey =
  (typeof ACCOUNT_HEALTH_FACTOR_KEYS)[number];

export interface AccountHealthFactor {
  key: AccountHealthFactorKey;
  points: number;
  message: string;
}

export const ACCOUNT_HEALTH_DAILY_KEY = 'UQ_account_health_daily_owner_day';

@Entity('account_health_daily')
@Unique(ACCOUNT_HEALTH_DAILY_KEY, ['ownerId', 'day'])
@Index('idx_account_health_daily_day_band', ['day', 'band', 'score'])
export class AccountHealthDaily {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'date' })
  day: string;

  @Column({ type: 'smallint' })
  score: number;

  @Column({ type: 'varchar', length: 10 })
  band: AccountHealthBand;

  @Column({ type: 'jsonb' })
  factors: AccountHealthFactor[];

  @Column({ name: 'computed_at', type: 'timestamptz' })
  computedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;
}
