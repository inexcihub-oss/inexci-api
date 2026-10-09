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
  Check,
} from 'typeorm';
import { User } from './user.entity';
import { Clinic } from './clinic.entity';
import { ClinicRoom } from './clinic-room.entity';

@Entity('doctor_schedules')
@Index('idx_doctor_schedules_doctor_weekday', ['doctorId', 'weekday'])
@Check('CHK_doctor_schedules_weekday', '"weekday" BETWEEN 0 AND 6')
@Check('CHK_doctor_schedules_slot_minutes', '"slot_minutes" BETWEEN 5 AND 240')
@Check('CHK_doctor_schedules_time', '"start_time" < "end_time"')
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

  @Column({ type: 'smallint' })
  weekday: number;

  @Column({ name: 'start_time', type: 'time' })
  startTime: string;

  @Column({ name: 'end_time', type: 'time' })
  endTime: string;

  @Column({ name: 'slot_minutes', type: 'smallint', default: 30 })
  slotMinutes: number;

  @Column({ name: 'max_walk_ins', type: 'smallint', nullable: true })
  maxWalkIns: number | null;

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

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_doctor_schedules_owner',
  })
  owner: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'doctor_id',
    foreignKeyConstraintName: 'FK_doctor_schedules_doctor',
  })
  doctor: User;

  @ManyToOne(() => Clinic, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'clinic_id',
    foreignKeyConstraintName: 'FK_doctor_schedules_clinic',
  })
  clinic: Clinic | null;

  @ManyToOne(() => ClinicRoom, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'room_id',
    foreignKeyConstraintName: 'FK_doctor_schedules_room',
  })
  room: ClinicRoom | null;
}
