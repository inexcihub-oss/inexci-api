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
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Hospital } from './hospital.entity';
import { Patient } from './patient.entity';
import { HealthPlan } from './health-plan.entity';
import { SurgeryRequestQuotation } from './surgery-request-quotation.entity';
import { OpmeItem } from './opme-item.entity';
import { Procedure } from './procedure.entity';
import { Document } from './document.entity';
import { SurgeryRequestAnalysis } from './surgery-request-analysis.entity';
import { SurgeryRequestBilling } from './surgery-request-billing.entity';
import { Contestation } from './contestation.entity';
import { SurgeryRequestTussItem } from './surgery-request-tuss-item.entity';
import { SurgeryRequestActivity } from './surgery-request-activity.entity';
import { ReportSection } from './report-section.entity';

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

/**
 * Opção de data para a cirurgia.
 * Persistida em dateOptions (jsonb).
 */
/**
 * Opções de datas armazenadas em date_options (jsonb).
 *
 * Formato atual: array de strings ISO ("2026-03-01"), ordenadas por preferência.
 * O índice selecionado pelo médico fica em `selected_date_index`.
 */
export type SurgeryDateOptions = string[];

/**
 * Documento requerido pendente de envio.
 * Persistido em required_documents (jsonb).
 */
export interface RequiredDocumentSpec {
  type: string;
  name: string;
}

@Entity('surgery_requests')
@Index('idx_sr_doctor_status', ['doctorId', 'status'])
@Index('idx_sr_owner_status', ['ownerId', 'status'])
@Index('idx_sr_patient_id', ['patientId'])
@Index('idx_sr_health_plan_id', ['healthPlanId'])
@Index('idx_sr_hospital_id', ['hospitalId'])
@Index('idx_sr_status', ['status'])
export class SurgeryRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ============ RELACIONAMENTOS PRINCIPAIS ============

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  /** ID do admin dono da clínica (denormalizado para tenant isolation). */
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @Column({ name: 'hospital_id', type: 'uuid', nullable: true })
  hospitalId: string | null;

  @Column({ name: 'health_plan_id', type: 'uuid', nullable: true })
  healthPlanId: string | null;

  @Column({ name: 'procedure_id', type: 'uuid', nullable: true })
  procedureId: string | null;

  /**
   * Código CID armazenado diretamente (ex: "A00", "K80.0").
   * A tabela CID foi removida; os dados vêm de src/utils/cid.json.
   */
  @Column({ name: 'cid_code', type: 'varchar', length: 10, nullable: true })
  cidCode: string | null;

  // ============ STATUS E CONTROLE ============

  @Column({
    type: 'smallint',
    default: SurgeryRequestStatus.PENDING,
  })
  status: SurgeryRequestStatus;

  @Column({ type: 'varchar', length: 75, nullable: true, unique: true })
  protocol: string | null;

  @Column({
    type: 'smallint',
    default: SurgeryRequestPriority.MEDIUM,
  })
  priority: SurgeryRequestPriority;

  // ============ OPME ============

  /**
   * Indica se a solicitação utiliza OPME.
   * null = ainda não informado (pendência aberta)
   * true = utiliza OPME (itens devem ser cadastrados)
   * false = não utiliza OPME (pendência resolvida sem necessidade de itens)
   */
  @Column({ name: 'has_opme', type: 'boolean', nullable: true, default: null })
  hasOpme: boolean | null;

  @Column({
    name: 'required_documents',
    type: 'jsonb',
    nullable: true,
    default: null,
  })
  requiredDocuments: RequiredDocumentSpec[] | null;

  // ============ INDICAÇÃO ============

  @Column({ name: 'is_indication', type: 'boolean', default: false })
  isIndication: boolean;

  @Column({
    name: 'indication_name',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  indicationName: string | null;

  // ============ DADOS DO CONVÊNIO ============

  @Column({
    name: 'health_plan_registration',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  healthPlanRegistration: string | null;

  @Column({
    name: 'health_plan_type',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  healthPlanType: string | null;

  @Column({
    name: 'health_plan_protocol',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  healthPlanProtocol: string | null;

  // ============ DADOS MÉDICOS ============

  @Column({ type: 'text', nullable: true })
  diagnosis: string | null;

  @Column({ name: 'medical_report', type: 'text', nullable: true })
  medicalReport: string | null;

  @Column({ name: 'patient_history', type: 'text', nullable: true })
  patientHistory: string | null;

  @Column({ name: 'surgery_description', type: 'text', nullable: true })
  surgeryDescription: string | null;

  // ============ DATAS ============

  @Column({ name: 'date_options', type: 'jsonb', nullable: true })
  dateOptions: SurgeryDateOptions | null;

  @Column({ name: 'selected_date_index', type: 'int', nullable: true })
  selectedDateIndex: number | null;

  @Column({ name: 'surgery_date', type: 'timestamp', nullable: true })
  surgeryDate: Date | null;

  @Column({ name: 'analysis_started_at', type: 'timestamp', nullable: true })
  analysisStartedAt: Date | null;

  @Column({ name: 'date_call', type: 'timestamp', nullable: true })
  dateCall: Date | null;

  // ============ PROTOCOLOS ============

  @Column({
    name: 'hospital_protocol',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  hospitalProtocol: string | null;

  // ============ ENVIO ============

  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'send_method', type: 'varchar', length: 20, nullable: true })
  sendMethod: string | null;

  // ============ REALIZAÇÃO ============

  @Column({ name: 'surgery_performed_at', type: 'timestamp', nullable: true })
  surgeryPerformedAt: Date | null;

  // ============ ENCERRAMENTO ============

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason: string | null;

  @Column({ name: 'closed_at', type: 'timestamp', nullable: true })
  closedAt: Date | null;

  @Column({
    name: 'last_status_changed_at',
    type: 'timestamp',
    nullable: true,
  })
  lastStatusChangedAt: Date | null;

  // ============ TIMESTAMPS ============

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ============ RELAÇÕES ============

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor: User;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;

  @ManyToOne(() => Patient, (patient) => patient.surgeryRequests)
  @JoinColumn({ name: 'patient_id' })
  patient: Patient;

  @ManyToOne(() => Hospital, (hospital) => hospital.surgeryRequests, {
    nullable: true,
  })
  @JoinColumn({ name: 'hospital_id' })
  hospital: Hospital | null;

  @ManyToOne(() => HealthPlan, (plan) => plan.surgeryRequests, {
    nullable: true,
  })
  @JoinColumn({ name: 'health_plan_id' })
  healthPlan: HealthPlan | null;

  @OneToMany(
    () => SurgeryRequestQuotation,
    (quotation) => quotation.surgeryRequest,
  )
  quotations: SurgeryRequestQuotation[];

  @OneToMany(() => OpmeItem, (item) => item.surgeryRequest)
  opmeItems: OpmeItem[];

  @ManyToOne(() => Procedure, { nullable: true })
  @JoinColumn({ name: 'procedure_id' })
  procedure: Procedure | null;

  @OneToMany(() => Document, (doc) => doc.surgeryRequest)
  documents: Document[];

  @OneToOne(
    () => SurgeryRequestAnalysis,
    (analysis) => analysis.surgeryRequest,
    {
      nullable: true,
    },
  )
  analysis: SurgeryRequestAnalysis | null;

  @OneToOne(() => SurgeryRequestBilling, (billing) => billing.surgeryRequest, {
    nullable: true,
  })
  billing: SurgeryRequestBilling | null;

  @OneToMany(() => Contestation, (contestation) => contestation.surgeryRequest)
  contestations: Contestation[];

  @OneToMany(() => SurgeryRequestTussItem, (item) => item.surgeryRequest)
  tussItems: SurgeryRequestTussItem[];

  @OneToMany(
    () => SurgeryRequestActivity,
    (activity) => activity.surgeryRequest,
  )
  activities: SurgeryRequestActivity[];

  @OneToMany(() => ReportSection, (section) => section.surgeryRequest, {
    cascade: true,
  })
  reportSections: ReportSection[];
}
