import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';

/**
 * Status da assinatura/plano do médico
 */
export enum SubscriptionStatus {
  TRIAL = 'trial',
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

/**
 * Perfil específico do médico
 * Contém dados profissionais que só se aplicam a usuários com role = DOCTOR
 */
@Entity('doctor_profile')
export class DoctorProfile {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', unique: true })
  user_id: number;

  // ============ DADOS PROFISSIONAIS ============

  @Column({ type: 'varchar', length: 100, nullable: true })
  specialty: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  crm: string;

  @Column({ type: 'char', length: 2, nullable: true })
  crm_state: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  signature_url: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  clinic_name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  clinic_cnpj: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  clinic_address: string;

  // ============ ASSINATURA/PLANO ============

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.TRIAL,
  })
  subscription_status: SubscriptionStatus;

  @Column({ type: 'varchar', length: 50, nullable: true })
  subscription_plan: string; // starter, professional, enterprise

  @Column({ type: 'timestamp', nullable: true })
  subscription_expires_at: Date;

  @Column({ type: 'int', default: 50 })
  max_requests_per_month: number;

  @Column({ type: 'int', default: 1 })
  max_team_members: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  @OneToOne('User', 'doctor_profile')
  @JoinColumn({ name: 'user_id' })
  user: any; // User

  // Solicitações cirúrgicas deste médico
  @OneToMany('SurgeryRequest', 'doctor')
  surgery_requests: any[]; // SurgeryRequest[]

  // Pacientes deste médico
  @OneToMany('Patient', 'doctor')
  patients: any[]; // Patient[]

  // Documentos padrão da clínica
  @OneToMany('DefaultDocumentClinic', 'doctor')
  default_documents: any[]; // DefaultDocumentClinic[]
}
