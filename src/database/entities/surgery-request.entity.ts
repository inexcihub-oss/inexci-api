import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { DoctorProfile } from './doctor-profile.entity';
import { User } from './user.entity';
import { Hospital } from './hospital.entity';
import { Patient } from './patient.entity';
import { HealthPlan } from './health-plan.entity';
import { SurgeryRequestQuotation } from './surgery-request-quotation.entity';
import { OpmeItem } from './opme-item.entity';
import { SurgeryRequestProcedure } from './surgery-request-procedure.entity';
import { Document } from './document.entity';
import { Chat } from './chat.entity';
import { StatusUpdate } from './status-update.entity';
import { SurgeryRequestAnalysis } from './surgery-request-analysis.entity';
import { SurgeryRequestBilling } from './surgery-request-billing.entity';
import { Contestation } from './contestation.entity';

/**
 * Status da solicitação cirúrgica (9 valores — fluxo oficial)
 */
export enum SurgeryRequestStatus {
  PENDING = 1, // Pendente
  SENT = 2, // Enviada
  IN_ANALYSIS = 3, // Em Análise
  IN_SCHEDULING = 4, // Em Agendamento
  SCHEDULED = 5, // Agendada
  PERFORMED = 6, // Realizada
  INVOICED = 7, // Faturada
  FINALIZED = 8, // Finalizada
  CLOSED = 9, // Encerrada
}

/**
 * Prioridade da solicitação cirúrgica
 */
export enum SurgeryRequestPriority {
  LOW = 1, // Baixa
  MEDIUM = 2, // Média
  HIGH = 3, // Alta
  URGENT = 4, // Urgente
}

@Entity('surgery_request')
export class SurgeryRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ============ RELACIONAMENTOS PRINCIPAIS ============

  @Column({ name: 'doctor_id' })
  doctor_id: string;

  @Column({ name: 'created_by_id' })
  created_by_id: string; // Quem criou (médico ou colaborador)

  @Column({ name: 'manager_id', nullable: true })
  manager_id: string; // Gestor/colaborador que vai gerenciar a solicitação

  @Column({ name: 'patient_id' })
  patient_id: string;

  @Column({ name: 'hospital_id', nullable: true })
  hospital_id: string;

  @Column({ name: 'health_plan_id', nullable: true })
  health_plan_id: string;

  @Column({ name: 'cid_id', type: 'varchar', length: 75, nullable: true })
  cid_id: string;

  @Column({
    name: 'cid_description',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  cid_description: string;

  // ============ STATUS E CONTROLE ============

  @Column({
    type: 'smallint',
    default: SurgeryRequestStatus.PENDING,
  })
  status: SurgeryRequestStatus;

  @Column({ type: 'varchar', length: 75, nullable: true, unique: true })
  protocol: string;

  @Column({
    type: 'smallint',
    default: SurgeryRequestPriority.MEDIUM,
  })
  priority: SurgeryRequestPriority; // 1=Baixa, 2=Média, 3=Alta, 4=Urgente

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

  // ============ ENVIO ============

  @Column({ type: 'timestamp', nullable: true })
  sent_at: Date; // Quando foi enviada para a operadora

  @Column({ type: 'varchar', length: 20, nullable: true })
  send_method: string; // 'email' | 'download'

  // ============ REALIZAÇÃO ============

  @Column({ type: 'timestamp', nullable: true })
  surgery_performed_at: Date; // Data/hora real da cirurgia

  // ============ ENCERRAMENTO ============

  @Column({ type: 'text', nullable: true })
  cancel_reason: string;

  @Column({ type: 'timestamp', nullable: true })
  closed_at: Date; // Quando foi encerrada/arquivada

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

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'manager_id' })
  manager: User;

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

  @OneToMany(
    () => SurgeryRequestQuotation,
    (quotation) => quotation.surgery_request,
  )
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

  @OneToOne(
    () => SurgeryRequestAnalysis,
    (analysis) => analysis.surgery_request,
    {
      nullable: true,
    },
  )
  analysis: SurgeryRequestAnalysis;

  @OneToOne(() => SurgeryRequestBilling, (billing) => billing.surgery_request, {
    nullable: true,
  })
  billing: SurgeryRequestBilling;

  @OneToMany(() => Contestation, (contestation) => contestation.surgery_request)
  contestations: Contestation[];
}
