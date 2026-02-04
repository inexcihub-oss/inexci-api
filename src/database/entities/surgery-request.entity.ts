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
import { DoctorProfile } from './doctor-profile.entity';
import { User } from './user.entity';
import { Hospital } from './hospital.entity';
import { Patient } from './patient.entity';
import { HealthPlan } from './health-plan.entity';
import { Cid } from './cid.entity';
import { SurgeryRequestQuotation } from './surgery-request-quotation.entity';
import { OpmeItem } from './opme-item.entity';
import { SurgeryRequestProcedure } from './surgery-request-procedure.entity';
import { Document } from './document.entity';
import { Chat } from './chat.entity';
import { StatusUpdate } from './status-update.entity';

/**
 * Status da solicitação cirúrgica
 */
export enum SurgeryRequestStatus {
  PENDING = 1, // Pendente (em rascunho)
  SENT = 2, // Enviada para análise
  IN_ANALYSIS = 3, // Em análise pelo convênio
  REANALYSIS = 4, // Em reanálise
  AUTHORIZED = 5, // Autorizada
  SCHEDULED = 6, // Agendada
  TO_INVOICE = 7, // A faturar (cirurgia realizada)
  INVOICED = 8, // Faturada
  FINALIZED = 9, // Finalizada
  CANCELLED = 10, // Cancelada
}

@Entity('surgery_request')
export class SurgeryRequest {
  @PrimaryGeneratedColumn()
  id: number;

  // ============ RELACIONAMENTOS PRINCIPAIS ============

  @Column({ name: 'doctor_id' })
  doctor_id: number;

  @Column({ name: 'created_by_id' })
  created_by_id: number; // Quem criou (médico ou colaborador)

  @Column({ name: 'patient_id' })
  patient_id: number;

  @Column({ name: 'hospital_id', nullable: true })
  hospital_id: number;

  @Column({ name: 'health_plan_id', nullable: true })
  health_plan_id: number;

  @Column({ name: 'cid_id', type: 'varchar', length: 75, nullable: true })
  cid_id: string;

  // ============ STATUS E CONTROLE ============

  @Column({
    type: 'smallint',
    default: SurgeryRequestStatus.PENDING,
  })
  status: SurgeryRequestStatus;

  @Column({ type: 'varchar', length: 75, nullable: true, unique: true })
  protocol: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  priority: string; // Baixa, Média, Alta, Urgente

  @Column({ type: 'timestamp', nullable: true })
  deadline: Date;

  // ============ INDICAÇÃO ============

  @Column({ type: 'boolean', default: false })
  is_indication: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  indication_name: string;

  // ============ DADOS DO CONVÊNIO ============

  @Column({ type: 'varchar', length: 100, nullable: true })
  health_plan_registration: string; // Número da carteirinha

  @Column({ type: 'varchar', length: 100, nullable: true })
  health_plan_type: string; // Tipo do plano

  @Column({ type: 'varchar', length: 100, nullable: true })
  health_plan_protocol: string; // Protocolo do convênio

  // ============ DADOS MÉDICOS ============

  @Column({ type: 'text', nullable: true })
  diagnosis: string;

  @Column({ type: 'text', nullable: true })
  medical_report: string;

  @Column({ type: 'text', nullable: true })
  patient_history: string;

  @Column({ type: 'text', nullable: true })
  surgery_description: string;

  // ============ DATAS ============

  @Column({ type: 'jsonb', nullable: true })
  date_options: any; // Opções de data para o paciente escolher

  @Column({ type: 'int', nullable: true })
  selected_date_index: number; // Índice da data escolhida

  @Column({ type: 'timestamp', nullable: true })
  surgery_date: Date; // Data da cirurgia

  @Column({ type: 'timestamp', nullable: true })
  analysis_started_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  date_call: Date;

  // ============ PROTOCOLOS ============

  @Column({ type: 'varchar', length: 100, nullable: true })
  hospital_protocol: string;

  // ============ FATURAMENTO ============

  @Column({ type: 'decimal', precision: 19, scale: 2, nullable: true })
  invoiced_value: number;

  @Column({ type: 'decimal', precision: 19, scale: 2, nullable: true })
  received_value: number;

  @Column({ type: 'timestamp', nullable: true })
  invoiced_date: Date;

  @Column({ type: 'timestamp', nullable: true })
  received_date: Date;

  // ============ CANCELAMENTO ============

  @Column({ type: 'text', nullable: true })
  cancel_reason: string;

  @Column({ type: 'timestamp', nullable: true })
  cancelled_at: Date;

  // ============ TIMESTAMPS ============

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  @ManyToOne(() => DoctorProfile, (doctor) => doctor.surgery_requests)
  @JoinColumn({ name: 'doctor_id' })
  doctor: DoctorProfile;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'created_by_id' })
  created_by: User;

  @ManyToOne(() => Patient, (patient) => patient.surgery_requests)
  @JoinColumn({ name: 'patient_id' })
  patient: Patient;

  @ManyToOne(() => Hospital, (hospital) => hospital.surgery_requests, {
    nullable: true,
  })
  @JoinColumn({ name: 'hospital_id' })
  hospital: Hospital;

  @ManyToOne(() => HealthPlan, (plan) => plan.surgery_requests, {
    nullable: true,
  })
  @JoinColumn({ name: 'health_plan_id' })
  health_plan: HealthPlan;

  @ManyToOne(() => Cid, (cid) => cid.surgery_requests, { nullable: true })
  @JoinColumn({ name: 'cid_id' })
  cid: Cid;

  @OneToMany(() => SurgeryRequestQuotation, (quotation) => quotation.surgery_request)
  quotations: SurgeryRequestQuotation[];

  @OneToMany(() => OpmeItem, (item) => item.surgery_request)
  opme_items: OpmeItem[];

  @OneToMany(() => SurgeryRequestProcedure, (proc) => proc.surgery_request)
  procedures: SurgeryRequestProcedure[];

  @OneToMany(() => Document, (doc) => doc.surgery_request)
  documents: Document[];

  @OneToMany(() => Chat, (chat) => chat.surgery_request)
  chats: Chat[];

  @OneToMany(() => StatusUpdate, (update) => update.surgery_request)
  status_updates: StatusUpdate[];
}
