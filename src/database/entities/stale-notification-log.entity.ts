import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';

@Entity('stale_notification_logs')
export class StaleNotificationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id', type: 'uuid' })
  surgeryRequestId: string;

  @Column({ name: 'stale_days', type: 'integer' })
  staleDays: number;

  @Column({ type: 'varchar', length: 20, default: 'in_app' })
  channel: string;

  @CreateDateColumn({ name: 'notified_at' })
  notifiedAt: Date;

  @ManyToOne(() => SurgeryRequest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'surgery_request_id' })
  surgeryRequest: SurgeryRequest;
}
