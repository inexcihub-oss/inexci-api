import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Status do vínculo de acesso
 */
export enum UserDoctorAccessStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/**
 * Tabela de vínculos de acesso entre usuários e médicos.
 * Define quais usuários podem visualizar e gerenciar as solicitações
 * cirúrgicas de quais médicos.
 *
 * Regras:
 * - Médicos não precisam de vínculo para acessar as próprias solicitações.
 * - Apenas o admin pode criar, ativar ou desativar vínculos.
 * - Remoção é sempre soft-delete (status = 'inactive').
 * - Reativação é upsert para 'active'.
 */
@Entity('user_doctor_access')
@Unique(['user_id', 'doctor_user_id'])
export class UserDoctorAccess {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  user_id: string;

  @Column({ name: 'doctor_user_id' })
  doctor_user_id: string;

  @Column({
    type: 'enum',
    enum: UserDoctorAccessStatus,
    default: UserDoctorAccessStatus.ACTIVE,
  })
  status: UserDoctorAccessStatus;

  @Column({ name: 'created_by_id', nullable: true })
  created_by_id: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  // Usuário que recebe o acesso
  @ManyToOne(() => User, (user) => user.doctor_accesses, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // Médico cujas solicitações podem ser acessadas
  @ManyToOne(() => User, (user) => user.accessible_by, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_user_id' })
  doctor: User;

  // Admin que criou/modificou o vínculo
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  created_by: User;
}
