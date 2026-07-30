import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';
import { User } from './user.entity';
import { Contestation } from './contestation.entity';
import { Patient } from './patient.entity';
import { ClinicalRecord } from './clinical-record.entity';

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK para solicitação cirúrgica (nullable — documentos de atendimento não têm SC). */
  @Column({ name: 'surgery_request_id', type: 'uuid', nullable: true })
  surgeryRequestId: string | null;

  /** FK para paciente (nullable) — documentos/exames anexados ao paciente. */
  @Column({ name: 'patient_id', type: 'uuid', nullable: true })
  patientId: string | null;

  /** FK para ficha de atendimento (nullable) — vínculo opcional com a consulta. */
  @Column({ name: 'clinical_record_id', type: 'uuid', nullable: true })
  clinicalRecordId: string | null;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  /** Tipo do documento (ex: 'personal_document', 'doctor_request', etc.) */
  @Column({ type: 'varchar', length: 75 })
  type: string;

  @Column({ type: 'varchar', length: 50 })
  key: string;

  @Column({ type: 'varchar', length: 75 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  uri: string | null;

  /** FK para contestação (nullable) — documentos anexados a uma contestação */
  @Column({ name: 'contestation_id', type: 'uuid', nullable: true })
  contestationId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => SurgeryRequest, (request) => request.documents, {
    nullable: true,
  })
  @JoinColumn({ name: 'surgery_request_id' })
  surgeryRequest: SurgeryRequest | null;

  @ManyToOne(() => Patient, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id' })
  patient: Patient | null;

  @ManyToOne(() => ClinicalRecord, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'clinical_record_id' })
  clinicalRecord: ClinicalRecord | null;

  @ManyToOne(() => User, (user) => user.insertedDocuments)
  @JoinColumn({ name: 'created_by_id' })
  creator: User;

  @ManyToOne(() => Contestation, (contestation) => contestation.documents, {
    nullable: true,
  })
  @JoinColumn({ name: 'contestation_id' })
  contestation: Contestation | null;
}
