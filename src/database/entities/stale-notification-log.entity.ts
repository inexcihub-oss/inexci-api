import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';

@Entity('stale_notification_log')
export class StaleNotificationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: string;

  @Column({ type: 'integer' })
  stale_days: number;

  @Column({ type: 'varchar', length: 20, default: 'in_app' })
  channel: string;

  @CreateDateColumn({ name: 'notified_at' })
  notified_at: Date;

  @ManyToOne(() => SurgeryRequest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;
}
