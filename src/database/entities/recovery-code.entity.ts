import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum RecoveryCodePurpose {
  PASSWORD_RESET = 'password_reset',
  INVITE = 'invite',
}

@Entity('recovery_codes')
export class RecoveryCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'boolean', default: false })
  used: boolean;

  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({
    type: 'varchar',
    length: 32,
    default: RecoveryCodePurpose.PASSWORD_RESET,
  })
  purpose: RecoveryCodePurpose;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({
    name: 'reset_token',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  resetToken: string | null;

  @Column({
    name: 'reset_token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  resetTokenExpiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.recoveryCodes)
  @JoinColumn({ name: 'user_id' })
  user: User;
}
