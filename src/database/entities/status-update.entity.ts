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
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: string;

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
