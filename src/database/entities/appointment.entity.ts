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
  Exclusion,
} from 'typeorm';
import { User } from './user.entity';
import { Patient } from './patient.entity';
import { Clinic } from './clinic.entity';
import { ClinicRoom } from './clinic-room.entity';
import { HealthPlan } from './health-plan.entity';

export enum AppointmentType {
  FIRST_VISIT = 'first_visit',
  RETURN = 'return',
  FOLLOW_UP = 'follow_up',
}

export enum AppointmentStatus {
  SCHEDULED = 'scheduled',
  CONFIRMED = 'confirmed',
  WAITING = 'waiting',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
}

export const ACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.WAITING,
  AppointmentStatus.IN_PROGRESS,
];

export const isActiveAppointmentStatus = (status: AppointmentStatus): boolean =>
  ACTIVE_APPOINTMENT_STATUSES.includes(status);

export const OCCUPYING_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  ...ACTIVE_APPOINTMENT_STATUSES,
  AppointmentStatus.COMPLETED,
];

export const APPOINTMENTS_NO_OVERLAP_CONSTRAINT =
  'EX_appointments_doctor_no_overlap';

export const APPOINTMENTS_NO_OVERLAP_EXCLUSION =
  `USING gist ("doctor_id" WITH =, ` +
  `tsrange(timezone('UTC', "scheduled_at"), ` +
  `timezone('UTC', "scheduled_at") + "duration_minutes" * interval '1 minute', '[)') WITH &&) ` +
  `WHERE ("status" IN (${OCCUPYING_APPOINTMENT_STATUSES.map((s) => `'${s}'`).join(', ')}) ` +
  `AND NOT "is_walk_in" AND "deleted_at" IS NULL)`;

export const PG_EXCLUSION_VIOLATION = '23P01';

@Entity('appointments')
@Index('idx_appointments_owner_id', ['ownerId'])
@Index('idx_appointments_doctor_id', ['doctorId'])
@Index('idx_appointments_patient_id', ['patientId'])
@Index('idx_appointments_scheduled_at', ['scheduledAt'])
@Index('idx_appointments_clinic_id', ['clinicId'])
@Index('idx_appointments_room_id', ['roomId'])
@Index('idx_appointments_health_plan_id', ['healthPlanId'])
@Index('idx_appointments_created_by_id', ['createdById'])
@Exclusion(
  APPOINTMENTS_NO_OVERLAP_CONSTRAINT,
  APPOINTMENTS_NO_OVERLAP_EXCLUSION,
)
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @Column({ name: 'clinic_id', type: 'uuid', nullable: true })
  clinicId: string | null;

  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  @Column({ name: 'is_walk_in', type: 'boolean', default: false })
  isWalkIn: boolean;

  @Column({ name: 'health_plan_id', type: 'uuid', nullable: true })
  healthPlanId: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

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

  @Column({ name: 'reminder_sent_at', type: 'timestamptz', nullable: true })
  reminderSentAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'doctor_id',
    foreignKeyConstraintName: 'FK_appointments_doctor',
  })
  doctor: User;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_appointments_owner',
  })
  owner: User;

  @ManyToOne(() => Patient, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'patient_id',
    foreignKeyConstraintName: 'FK_appointments_patient',
  })
  patient: Patient;

  @ManyToOne(() => Clinic, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'clinic_id',
    foreignKeyConstraintName: 'FK_appointments_clinic',
  })
  clinic: Clinic | null;

  @ManyToOne(() => ClinicRoom, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'room_id',
    foreignKeyConstraintName: 'FK_appointments_room',
  })
  room: ClinicRoom | null;

  @ManyToOne(() => HealthPlan, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'health_plan_id',
    foreignKeyConstraintName: 'FK_appointments_health_plan',
  })
  healthPlan: HealthPlan | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_appointments_created_by',
  })
  createdBy: User | null;
}
