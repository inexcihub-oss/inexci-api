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

@Entity('recovery_codes')
export class RecoveryCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'boolean', default: false })
  used: boolean;

  @Column({ type: 'varchar', length: 6 })
  code: string;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  /**
   * Reset token de uso único emitido após a validação do código. Exigido no
   * `changePassword` para amarrar a validação do código à troca de senha
   * (evita trocar a senha apenas por existir "algum" código usado).
   */
  @Column({
    name: 'reset_token',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  resetToken: string | null;

  @Column({
    name: 'reset_token_expires_at',
    type: 'timestamp',
    nullable: true,
  })
  resetTokenExpiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => User, (user) => user.recoveryCodes)
  @JoinColumn({ name: 'user_id' })
  user: User;
}
