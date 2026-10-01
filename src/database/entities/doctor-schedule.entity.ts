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
import { Clinic } from './clinic.entity';
import { ClinicRoom } from './clinic-room.entity';

/**
 * Grade semanal de atendimento de um profissional (MIG-05): em que dia da
 * semana, de que horas a que horas, com que intervalo de slot e, opcionalmente,
 * em que clínica/sala e em que período de vigência.
 *
 * A grade **orienta** (horários livres, aviso de "fora da grade"); quem
 * **impede** agendar são o bloqueio e o feriado.
 */
@Entity('doctor_schedules')
@Index('idx_doctor_schedules_doctor_weekday', ['doctorId', 'weekday'])
export class DoctorSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  @Column({ name: 'clinic_id', type: 'uuid', nullable: true })
  clinicId: string | null;

  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  /** 0 = domingo … 6 = sábado (como `Date.getDay`). */
  @Column({ type: 'smallint' })
  weekday: number;

  /** `HH:MM:SS`, horário de São Paulo. */
  @Column({ name: 'start_time', type: 'time' })
  startTime: string;

  @Column({ name: 'end_time', type: 'time' })
  endTime: string;

  @Column({ name: 'slot_minutes', type: 'smallint', default: 30 })
  slotMinutes: number;

  @Column({ name: 'max_walk_ins', type: 'smallint', nullable: true })
  maxWalkIns: number | null;

  /** `YYYY-MM-DD`; nulo = sem limite. */
  @Column({ name: 'valid_from', type: 'date', nullable: true })
  validFrom: string | null;

  @Column({ name: 'valid_to', type: 'date', nullable: true })
  validTo: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor: User;

  @ManyToOne(() => Clinic, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'clinic_id' })
  clinic: Clinic | null;

  @ManyToOne(() => ClinicRoom, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'room_id' })
  room: ClinicRoom | null;
}
