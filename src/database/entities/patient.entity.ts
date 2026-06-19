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
import { HealthPlan } from './health-plan.entity';
import { SurgeryRequest } from './surgery-request.entity';

/**
 * Paciente — Entidade de negócio (não faz login).
 * Pertence a um médico (doctorId) e a uma clínica (ownerId).
 * O ownerId é denormalizado para acelerar filtros de tenant isolation.
 */
@Entity('patients')
@Index('idx_patients_doctor_id', ['doctorId'])
@Index('idx_patients_owner_id', ['ownerId'])
export class Patient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  /** ID do admin dono da clínica (denormalizado para tenant isolation). */
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 14 })
  cpf: string;

  @Column({ type: 'char', length: 1, nullable: true })
  gender: string | null;

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate: Date | null;

  // ============ DADOS DO CONVÊNIO ============

  @Column({ name: 'health_plan_id', type: 'uuid', nullable: true })
  healthPlanId: string | null;

  /** Número da carteirinha */
  @Column({
    name: 'health_plan_number',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  healthPlanNumber: string | null;

  /** Tipo do plano (enfermaria, apartamento, etc) */
  @Column({
    name: 'health_plan_type',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  healthPlanType: string | null;

  // ============ ENDEREÇO ============

  @Column({ name: 'zip_code', type: 'varchar', length: 10, nullable: true })
  zipCode: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  address: string | null;

  @Column({
    name: 'address_number',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  addressNumber: string | null;

  @Column({
    name: 'address_complement',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  addressComplement: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  neighborhood: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'char', length: 2, nullable: true })
  state: string | null;

  // ============ OBSERVAÇÕES ============

  @Column({ name: 'medical_notes', type: 'text', nullable: true })
  medicalNotes: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  // ============ RELAÇÕES ============

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor: User;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @ManyToOne(() => HealthPlan, (hp) => hp.patients, { nullable: true })
  @JoinColumn({ name: 'health_plan_id' })
  healthPlan: HealthPlan | null;

  @OneToMany(() => SurgeryRequest, (sr) => sr.patient)
  surgeryRequests: SurgeryRequest[];
}
