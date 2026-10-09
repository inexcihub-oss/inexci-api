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

@Entity('schedule_blocks')
@Index('idx_schedule_blocks_doctor_range', ['doctorId', 'startsAt', 'endsAt'])
@Index('idx_schedule_blocks_owner_range', ['ownerId', 'startsAt'])
@Index('idx_schedule_blocks_created_by_id', ['createdById'])
@Check('CHK_schedule_blocks_range', '"starts_at" < "ends_at"')
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

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_schedule_blocks_owner',
  })
  owner: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'doctor_id',
    foreignKeyConstraintName: 'FK_schedule_blocks_doctor',
  })
  doctor: User | null;

  @ManyToOne(() => Clinic, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'clinic_id',
    foreignKeyConstraintName: 'FK_schedule_blocks_clinic',
  })
  clinic: Clinic | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_schedule_blocks_created_by',
  })
  createdBy: User | null;
}
