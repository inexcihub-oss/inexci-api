import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Patient } from './patient.entity';
import { Appointment } from './appointment.entity';

/** Código CID-10 associado a um atendimento. */
export interface ClinicalCidCode {
  code: string;
  description: string;
}

/**
 * ClinicalRecord — Ficha de atendimento / episódio clínico (prontuário).
 * Anamnese e evolução em HTML (RichTextEditor). Um registro finalizado
 * (`finalizedAt` != null) é imutável — correções viram um novo registro.
 */
@Entity('clinical_records')
@Index('idx_clinical_records_owner_id', ['ownerId'])
@Index('idx_clinical_records_patient_id', ['patientId'])
@Index('idx_clinical_records_appointment_id', ['appointmentId'])
// Uma consulta tem no máximo uma ficha viva; registro avulso (appointment_id
// nulo) e soft delete ficam de fora do índice.
@Index('idx_clinical_records_appointment_unique', ['appointmentId'], {
  unique: true,
  where: 'appointment_id IS NOT NULL AND deleted_at IS NULL',
})
export class ClinicalRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  /** ID do admin dono da clínica (denormalizado para tenant isolation). */
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  /** Consulta que originou o atendimento (opcional — permite registro avulso). */
  @Column({ name: 'appointment_id', type: 'uuid', nullable: true })
  appointmentId: string | null;

  @Column({ type: 'text', nullable: true })
  anamnesis: string | null;

  @Column({ name: 'physical_exam', type: 'text', nullable: true })
  physicalExam: string | null;

  @Column({ type: 'text', nullable: true })
  diagnosis: string | null;

  @Column({ name: 'cid_codes', type: 'jsonb', nullable: true })
  cidCodes: ClinicalCidCode[] | null;

  @Column({ type: 'text', nullable: true })
  conduct: string | null;

  /** Quando preenchido, o registro está fechado e não pode mais ser editado. */
  @Column({ name: 'finalized_at', type: 'timestamptz', nullable: true })
  finalizedAt: Date | null;

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

  @ManyToOne(() => Patient, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id' })
  patient: Patient;

  @ManyToOne(() => Appointment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'appointment_id' })
  appointment: Appointment | null;
}
