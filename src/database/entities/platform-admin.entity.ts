import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { encryptedTransformer } from '../../shared/crypto/encryption.util';

export enum PlatformAdminStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export const PLATFORM_ADMIN_EMAIL_UNICO = 'uq_platform_admins_email_lower';

@Entity('platform_admins')
@Index(PLATFORM_ADMIN_EMAIL_UNICO, { synchronize: false })
export class PlatformAdmin {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 160 })
  email: string;

  @Exclude()
  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
    select: false,
  })
  passwordHash: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: PlatformAdminStatus.PENDING,
  })
  status: PlatformAdminStatus;

  @Exclude()
  @Column({
    name: 'mfa_secret',
    type: 'text',
    nullable: true,
    select: false,
    transformer: encryptedTransformer,
  })
  mfaSecret: string | null;

  @Exclude()
  @Column({
    name: 'mfa_pending_secret',
    type: 'text',
    nullable: true,
    select: false,
    transformer: encryptedTransformer,
  })
  mfaPendingSecret: string | null;

  @Column({ name: 'mfa_enabled_at', type: 'timestamptz', nullable: true })
  mfaEnabledAt: Date | null;

  @Exclude()
  @Column({
    name: 'mfa_recovery_codes',
    type: 'text',
    array: true,
    nullable: true,
    select: false,
  })
  mfaRecoveryCodes: string[] | null;

  @Exclude()
  @Column({
    name: 'mfa_last_used_step',
    type: 'integer',
    nullable: true,
    select: false,
  })
  mfaLastUsedStep: number | null;

  @Exclude()
  @Column({ name: 'token_version', type: 'integer', default: 0 })
  tokenVersion: number;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Exclude()
  @Column({
    name: 'invite_token_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
    select: false,
  })
  inviteTokenHash: string | null;

  @Exclude()
  @Column({
    name: 'invite_expires_at',
    type: 'timestamptz',
    nullable: true,
    select: false,
  })
  inviteExpiresAt: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => PlatformAdmin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy?: PlatformAdmin | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
