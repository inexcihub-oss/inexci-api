import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Patient } from './patient.entity';
import { SurgeryRequest } from './surgery-request.entity';

/**
 * Plano de Saúde/Convênio — Entidade de negócio (não faz login).
 * Cadastro pertence à clínica/conta (ownerId): médicos e colaboradores
 * da mesma clínica compartilham os convênios cadastrados.
 */
@Entity('health_plans')
@Index('idx_health_plans_owner_id', ['ownerId'])
export class HealthPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  /** Código ANS */
  @Column({ name: 'ans_code', type: 'varchar', length: 20, nullable: true })
  ansCode: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  cnpj: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  phone: string | null;

  // ============ CONTATO PARA AUTORIZAÇÕES ============

  @Column({
    name: 'authorization_contact',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  authorizationContact: string | null;

  @Column({
    name: 'authorization_phone',
    type: 'varchar',
    length: 15,
    nullable: true,
  })
  authorizationPhone: string | null;

  @Column({
    name: 'authorization_email',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  authorizationEmail: string | null;

  // ============ WEBSITE/PORTAL ============

  @Column({ type: 'varchar', length: 255, nullable: true })
  website: string | null;

  /** URL do portal de autorizações */
  @Column({ name: 'portal_url', type: 'varchar', length: 255, nullable: true })
  portalUrl: string | null;

  // ============ FATURAMENTO ============

  /** Prazo padrão de pagamento em dias (usado como sugestão no faturamento) */
  @Column({ name: 'default_payment_days', type: 'int', nullable: true })
  defaultPaymentDays: number | null;

  // ============ OBSERVAÇÕES ============

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // ============ STATUS ============

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // ============ ISOLAMENTO POR CLÍNICA ============

  /** ID do admin dono da clínica. */
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  // ============ RELAÇÕES ============

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @OneToMany(() => Patient, (patient) => patient.healthPlan)
  patients: Patient[];

  @OneToMany(() => SurgeryRequest, (request) => request.healthPlan)
  surgeryRequests: SurgeryRequest[];
}
