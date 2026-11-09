import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export const PLATFORM_ERROR_SOURCES = [
  'http',
  'queue',
  'ai',
  'notification',
  'stripe_webhook',
] as const;

export type PlatformErrorSource = (typeof PLATFORM_ERROR_SOURCES)[number];

export const PLATFORM_ERROR_DAILY_KEY = 'UQ_platform_error_daily_key';

@Entity('platform_error_daily')
@Unique(PLATFORM_ERROR_DAILY_KEY, ['ownerId', 'day', 'source', 'fingerprint'])
export class PlatformErrorDaily {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({ type: 'date' })
  day: string;

  @Column({ type: 'varchar', length: 20 })
  source: PlatformErrorSource;

  @Column({ type: 'varchar', length: 64 })
  fingerprint: string;

  @Column({ name: 'error_class', type: 'varchar', length: 100, nullable: true })
  errorClass: string | null;

  @Column({
    name: 'sample_route',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  sampleRoute: string | null;

  @Column({ type: 'int', default: 1 })
  count: number;

  @Column({ name: 'first_seen_at', type: 'timestamptz' })
  firstSeenAt: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;

  @Column({
    name: 'last_message',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  lastMessage: string | null;

  @Column({
    name: 'last_request_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  lastRequestId: string | null;

  @Column({
    name: 'last_trace_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  lastTraceId: string | null;

  @Column({ name: 'last_user_id', type: 'uuid', nullable: true })
  lastUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
