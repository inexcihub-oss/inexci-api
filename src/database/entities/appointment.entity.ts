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
  /** Paciente chegou e aguarda na recepção (sala de espera). */
  WAITING = 'waiting',
  /** Atendimento em andamento (a ficha foi aberta). */
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
}

/**
 * Status de consulta ainda em aberto: pode virar "realizada", recebe lembrete
 * e aviso de cancelamento. Lista única para o service de consultas e para a
 * ficha de atendimento não divergirem. Para conflito de horário, veja
 * `OCCUPYING_APPOINTMENT_STATUSES`.
 */
export const ACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.WAITING,
  AppointmentStatus.IN_PROGRESS,
];

export const isActiveAppointmentStatus = (status: AppointmentStatus): boolean =>
  ACTIVE_APPOINTMENT_STATUSES.includes(status);

/**
 * Status que ocupam o horário na agenda (conflito e disponibilidade): os em
 * aberto mais a realizada — o horário foi usado. Cancelada e falta liberam:
 * se o paciente das 10h não veio, a recepção usa o horário sem encaixe.
 */
export const OCCUPYING_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  ...ACTIVE_APPOINTMENT_STATUSES,
  AppointmentStatus.COMPLETED,
];

/** Nome da exclusion constraint que impede consultas sobrepostas no banco. */
export const APPOINTMENTS_NO_OVERLAP_CONSTRAINT =
  'EX_appointments_doctor_no_overlap';

/**
 * Corpo da exclusion constraint (depois de `EXCLUDE`): duas consultas do mesmo
 * médico que ocupam o horário, não são encaixe e não foram excluídas não podem
 * ter intervalos `[início, fim)` sobrepostos. É a garantia contra a corrida do
 * check-then-insert de `assertNoOverlap` — o pré-check continua existindo só
 * para devolver uma mensagem amigável.
 *
 * `timezone('UTC', …)` converte `timestamptz` em `timestamp`: `timestamptz +
 * interval` é só STABLE (depende do fuso da sessão) e o Postgres exige
 * expressão IMMUTABLE em índice/constraint.
 *
 * Montado a partir de `OCCUPYING_APPOINTMENT_STATUSES`; a migration
 * `AddAppointmentsNoOverlapConstraint1755800900000` grava o mesmo texto
 * literal, e `add-appointments-no-overlap-constraint.migration.spec.ts`
 * falha se os dois divergirem. Mudou a lista de status? Escreva uma migration
 * nova que recrie a constraint — a antiga já rodou em produção.
 */
export const APPOINTMENTS_NO_OVERLAP_EXCLUSION =
  `USING gist ("doctor_id" WITH =, ` +
  `tsrange(timezone('UTC', "scheduled_at"), ` +
  `timezone('UTC', "scheduled_at") + "duration_minutes" * interval '1 minute', '[)') WITH &&) ` +
  `WHERE ("status" IN (${OCCUPYING_APPOINTMENT_STATUSES.map((s) => `'${s}'`).join(', ')}) ` +
  `AND NOT "is_walk_in" AND "deleted_at" IS NULL)`;

/** Código de erro do Postgres para violação de exclusion constraint. */
export const PG_EXCLUSION_VIOLATION = '23P01';

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

  /** ID do admin dono da clínica (denormalizado para tenant isolation). */
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  /** Local de atendimento. Opcional: consulta pode não ter unidade definida. */
  @Column({ name: 'clinic_id', type: 'uuid', nullable: true })
  clinicId: string | null;

  /** Sala dentro da clínica (opcional; precisa ser da mesma `clinicId`). */
  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  /**
   * Encaixe: marcado de propósito em cima de outro horário. Não passa pela
   * checagem de conflito; uma consulta normal continua não podendo ser
   * marcada em cima dele.
   */
  @Column({ name: 'is_walk_in', type: 'boolean', default: false })
  isWalkIn: boolean;

  /** Convênio da consulta; `null` = particular. */
  @Column({ name: 'health_plan_id', type: 'uuid', nullable: true })
  healthPlanId: string | null;

  /** Quem agendou. `null` em consultas anteriores a este campo. */
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
  // `foreignKeyConstraintName` = nome real no banco (doctor/owner/patient desde
  // `CreateAppointments`; as demais renomeadas em
  // `AddAppointmentsNoOverlapConstraint1755800900000`). Sem ele o TypeORM
  // gera um hash e `migration:generate` recriaria cada FK.

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
