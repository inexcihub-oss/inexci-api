import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export type ConsentType = 'ai' | 'privacy_policy' | 'terms_of_use';
export type ConsentAction = 'granted' | 'revoked';
export type ConsentChannel = 'web' | 'mobile' | 'api' | 'admin';

/**
 * Auditoria histórica de consentimentos (LGPD art. 8º §6º).
 * Cada aceite/revogação é um registro imutável; o estado atual fica
 * em campos `*_consent_at`/`*_consent_version` na tabela `user`.
 */
@Entity('consent_log')
@Index('idx_consent_log_user_type_created', [
  'user_id',
  'consent_type',
  'created_at',
])
export class ConsentLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 40 })
  consent_type: ConsentType;

  @Column({ type: 'varchar', length: 20 })
  version: string;

  @Column({ type: 'varchar', length: 20 })
  action: ConsentAction;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip_address: string | null;

  @Column({ type: 'text', nullable: true })
  user_agent: string | null;

  @Column({ type: 'varchar', length: 20, default: 'web' })
  channel: ConsentChannel;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
