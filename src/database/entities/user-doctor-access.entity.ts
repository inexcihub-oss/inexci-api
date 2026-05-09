import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
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
@Entity('user_doctor_accesses')
@Unique(['userId', 'doctorUserId'])
@Index('idx_uda_user_status', ['userId', 'status'])
@Index('idx_uda_doctor_status', ['doctorUserId', 'status'])
export class UserDoctorAccess {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'doctor_user_id', type: 'uuid' })
  doctorUserId: string;

  @Column({
    type: 'enum',
    enum: UserDoctorAccessStatus,
    default: UserDoctorAccessStatus.ACTIVE,
  })
  status: UserDoctorAccessStatus;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ============ RELAÇÕES ============

  // Usuário que recebe o acesso
  @ManyToOne(() => User, (user) => user.doctorAccesses, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // Médico cujas solicitações podem ser acessadas
  @ManyToOne(() => User, (user) => user.accessibleBy, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_user_id' })
  doctor: User;

  // Admin que criou/modificou o vínculo
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;
}
