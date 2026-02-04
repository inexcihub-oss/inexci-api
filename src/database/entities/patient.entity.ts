import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';

/**
 * Paciente - Entidade de negócio (não faz login)
 * Pertence a um médico específico
 */
@Entity('patient')
export class Patient {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'doctor_id' })
  doctor_id: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  phone: string;

  @Column({ type: 'varchar', length: 14, nullable: true })
  cpf: string;

  @Column({ type: 'char', length: 1, nullable: true })
  gender: string;

  @Column({ type: 'date', nullable: true })
  birth_date: Date;

  // ============ DADOS DO CONVÊNIO ============

  @Column({ name: 'health_plan_id', nullable: true })
  health_plan_id: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  health_plan_number: string; // Número da carteirinha

  @Column({ type: 'varchar', length: 100, nullable: true })
  health_plan_type: string; // Tipo do plano (enfermaria, apartamento, etc)

  // ============ ENDEREÇO ============

  @Column({ type: 'varchar', length: 10, nullable: true })
  zip_code: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  address: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  address_number: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  address_complement: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  neighborhood: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string;

  @Column({ type: 'char', length: 2, nullable: true })
  state: string;

  // ============ OBSERVAÇÕES ============

  @Column({ type: 'text', nullable: true })
  medical_notes: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  @ManyToOne('DoctorProfile', 'patients')
  @JoinColumn({ name: 'doctor_id' })
  doctor: any; // DoctorProfile

  @ManyToOne('HealthPlan', 'patients', { nullable: true })
  @JoinColumn({ name: 'health_plan_id' })
  health_plan: any; // HealthPlan

  @OneToMany('SurgeryRequest', 'patient')
  surgery_requests: any[]; // SurgeryRequest[]
}
