import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Appointment } from './appointment.entity';

export enum AppointmentActivityType {
  CREATED = 'created',
  STATUS_CHANGE = 'status_change',
  RESCHEDULED = 'rescheduled',
  UPDATED = 'updated',
  COMMENT = 'comment',
  SYSTEM = 'system',
}

@Entity('appointment_activities')
@Index('idx_appointment_activities_appointment_created', [
  'appointmentId',
  'createdAt',
])
export class AppointmentActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'appointment_id', type: 'uuid' })
  appointmentId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: AppointmentActivityType.COMMENT,
  })
  type: AppointmentActivityType;

  @Column({ name: 'from_status', type: 'varchar', length: 20, nullable: true })
  fromStatus: string | null;

  @Column({ name: 'to_status', type: 'varchar', length: 20, nullable: true })
  toStatus: string | null;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Appointment, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appointment_id' })
  appointment: Appointment;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;
}
