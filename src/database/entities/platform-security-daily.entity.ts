import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export const PLATFORM_SECURITY_EVENTS = [
  'login_failed',
  'login_locked',
  'mfa_failed',
  'refresh_reuse',
  'password_changed',
  'mfa_enabled',
  'mfa_disabled',
] as const;

export type PlatformSecurityEventType =
  (typeof PLATFORM_SECURITY_EVENTS)[number];

export const PLATFORM_SECURITY_DAILY_KEY = 'UQ_platform_security_daily_key';

@Entity('platform_security_daily')
@Unique(PLATFORM_SECURITY_DAILY_KEY, ['ownerId', 'userId', 'day', 'eventType'])
export class PlatformSecurityDaily {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'date' })
  day: string;

  @Column({ name: 'event_type', type: 'varchar', length: 30 })
  eventType: PlatformSecurityEventType;

  @Column({ type: 'int', default: 1 })
  count: number;

  @Column({ name: 'first_seen_at', type: 'timestamptz' })
  firstSeenAt: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;

  @Column({
    name: 'last_request_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  lastRequestId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
