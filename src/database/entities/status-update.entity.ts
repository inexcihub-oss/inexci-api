import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';

@Entity('status_update')
export class StatusUpdate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: number;

  @Column({ type: 'smallint' })
  prev_status: number;

  @Column({ type: 'smallint' })
  new_status: number;

  @CreateDateColumn()
  created_at: Date;

  // Relations
  @ManyToOne(() => SurgeryRequest, (request) => request.status_updates)
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;
}
