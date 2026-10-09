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
import { SurgeryRequest } from './surgery-request.entity';
import { Procedure } from './procedure.entity';

export interface ClinicalCidCode {
  code: string;
  description: string;
}

@Entity('clinical_records')
@Index('idx_clinical_records_owner_id', ['ownerId'])
@Index('idx_clinical_records_patient_id', ['patientId'])
@Index('idx_clinical_records_appointment_id', ['appointmentId'])
@Index('idx_clinical_records_appointment_unique', ['appointmentId'], {
  unique: true,
  where: 'appointment_id IS NOT NULL AND deleted_at IS NULL',
})
@Index('idx_clinical_records_indication_pending', ['finalizedAt'], {
  where:
    'surgical_indication = true AND surgery_request_id IS NULL AND finalized_at IS NOT NULL AND deleted_at IS NULL',
})
export class ClinicalRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

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

  @Column({ name: 'surgical_indication', type: 'boolean', default: false })
  surgicalIndication: boolean;

  @Column({ name: 'procedure_id', type: 'uuid', nullable: true })
  procedureId: string | null;

  @Column({ name: 'surgery_request_id', type: 'uuid', nullable: true })
  surgeryRequestId: string | null;

  @Column({ name: 'finalized_at', type: 'timestamptz', nullable: true })
  finalizedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

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

  @ManyToOne(() => SurgeryRequest, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'surgery_request_id' })
  surgeryRequest: SurgeryRequest | null;

  @ManyToOne(() => Procedure, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'procedure_id' })
  procedure: Procedure | null;
}
