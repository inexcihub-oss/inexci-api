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

/** Tipo da consulta. */
export enum AppointmentType {
  FIRST_VISIT = 'first_visit',
  RETURN = 'return',
  FOLLOW_UP = 'follow_up',
}

/** Status da consulta na agenda. */
export enum AppointmentStatus {
  SCHEDULED = 'scheduled',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
}

/**
 * Appointment — Consulta/retorno agendado para um paciente com um médico.
 * Base do módulo de atendimento (Fase 1). Pertence a um médico (doctorId) e a
 * uma clínica (ownerId, denormalizado para tenant isolation).
 */
@Entity('appointments')
@Index('idx_appointments_owner_id', ['ownerId'])
@Index('idx_appointments_doctor_id', ['doctorId'])
@Index('idx_appointments_patient_id', ['patientId'])
@Index('idx_appointments_scheduled_at', ['scheduledAt'])
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  /** ID do admin dono da clínica (denormalizado para tenant isolation). */
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @Column({ type: 'varchar', length: 20, default: AppointmentType.FIRST_VISIT })
  type: AppointmentType;

  @Column({ type: 'varchar', length: 20, default: AppointmentStatus.SCHEDULED })
  status: AppointmentStatus;

  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt: Date;

  @Column({ name: 'duration_minutes', type: 'int', default: 30 })
  durationMinutes: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string | null;

  /** Marca de idempotência do lembrete automático (24h antes). */
  @Column({ name: 'reminder_sent_at', type: 'timestamptz', nullable: true })
  reminderSentAt: Date | null;

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
}
