import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';

@Entity('opme_item')
export class OpmeItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: number;

  @Column({ type: 'varchar', length: 75 })
  name: string;

  @Column({ type: 'varchar', length: 75 })
  brand: string;

  @Column({ type: 'varchar', length: 75 })
  distributor: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'int', nullable: true })
  authorized_quantity: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Relations
  @ManyToOne(() => SurgeryRequest, (request) => request.opme_items)
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;
}
