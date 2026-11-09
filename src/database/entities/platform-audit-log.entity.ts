import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PlatformAdmin } from './platform-admin.entity';

export enum PlatformAuditAction {
  TRIAL_EXTENDED = 'TRIAL_EXTENDED',
  INTERNAL_ACCESS_GRANTED = 'INTERNAL_ACCESS_GRANTED',
  INTERNAL_ACCESS_REVOKED = 'INTERNAL_ACCESS_REVOKED',
  COUPON_CREATED = 'COUPON_CREATED',
  COUPON_DEACTIVATED = 'COUPON_DEACTIVATED',
  PLATFORM_ADMIN_CREATED = 'PLATFORM_ADMIN_CREATED',
  PLATFORM_ADMIN_REVOKED = 'PLATFORM_ADMIN_REVOKED',
  PLATFORM_ADMIN_ACCESS_RESET = 'PLATFORM_ADMIN_ACCESS_RESET',
  CRON_STALE_REQUESTS_TRIGGERED = 'CRON_STALE_REQUESTS_TRIGGERED',
  CRON_WEEKLY_SUMMARY_TRIGGERED = 'CRON_WEEKLY_SUMMARY_TRIGGERED',
  ACCOUNT_DEACTIVATED = 'ACCOUNT_DEACTIVATED',
  ACCOUNT_REACTIVATED = 'ACCOUNT_REACTIVATED',
  QUEUE_JOB_RETRIED = 'QUEUE_JOB_RETRIED',
  QUEUE_JOB_DISCARDED = 'QUEUE_JOB_DISCARDED',
  STRIPE_EVENT_REPROCESSED = 'STRIPE_EVENT_REPROCESSED',
  CLINICAL_ACCESS_EXPORTED = 'CLINICAL_ACCESS_EXPORTED',
  CLINICAL_ACCESS_PATIENT_VIEWED = 'CLINICAL_ACCESS_PATIENT_VIEWED',
}

export enum PlatformAuditStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

@Entity('platform_audit_logs')
@Index('idx_platform_audit_logs_target_owner_created', [
  'targetOwnerId',
  'createdAt',
])
@Index('idx_platform_audit_logs_actor_created', ['actorAdminId', 'createdAt'])
@Index('idx_platform_audit_logs_action_created', ['action', 'createdAt'])
export class PlatformAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_admin_id', type: 'uuid' })
  actorAdminId: string;

  @ManyToOne(() => PlatformAdmin)
  @JoinColumn({ name: 'actor_admin_id' })
  actor?: PlatformAdmin;

  @Column({ type: 'varchar', length: 40 })
  action: PlatformAuditAction;

  @Column({ name: 'target_owner_id', type: 'uuid', nullable: true })
  targetOwnerId: string | null;

  @Column({ name: 'target_user_id', type: 'uuid', nullable: true })
  targetUserId: string | null;

  @Column({ name: 'target_admin_id', type: 'uuid', nullable: true })
  targetAdminId: string | null;

  @ManyToOne(() => PlatformAdmin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'target_admin_id' })
  targetAdmin?: PlatformAdmin | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @Column({ name: 'gateway_ref', type: 'varchar', length: 200, nullable: true })
  gatewayRef: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: PlatformAuditStatus.PENDING,
  })
  status: PlatformAuditStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
