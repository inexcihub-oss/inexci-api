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

/**
 * Bloqueio pontual da agenda (MIG-05): férias, congresso, reunião. Impede
 * agendar no intervalo, inclusive encaixe. `doctorId` nulo = toda a clínica
 * (de `clinicId`, ou da conta inteira se também for nulo).
 */
@Entity('schedule_blocks')
@Index('idx_schedule_blocks_doctor_range', ['doctorId', 'startsAt', 'endsAt'])
export class ScheduleBlock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'doctor_id', type: 'uuid', nullable: true })
  doctorId: string | null;

  @Column({ name: 'clinic_id', type: 'uuid', nullable: true })
  clinicId: string | null;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Column({ name: 'all_day', type: 'boolean', default: false })
  allDay: boolean;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reason: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor: User | null;

  @ManyToOne(() => Clinic, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clinic_id' })
  clinic: Clinic | null;
}
