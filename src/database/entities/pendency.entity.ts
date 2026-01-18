import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';
import { User } from './user.entity';

@Entity('pendency')
export class Pendency {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: number;

  @Column({ name: 'responsible_id' })
  responsible_id: number;

  @Column({ type: 'varchar', length: 50 })
  key: string;

  @Column({ type: 'boolean', default: false })
  created_manually: boolean;

  @Column({ type: 'varchar', length: 75 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'timestamp', nullable: true })
  concluded_at: Date;

  @CreateDateColumn()
  created_at: Date;

  // Relations
  @ManyToOne(() => SurgeryRequest, (request) => request.pendencies)
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;

  @ManyToOne(() => User, (user) => user.pendencies)
  @JoinColumn({ name: 'responsible_id' })
  responsible: User;
}
