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

@Entity('surgery_request_tuss_items')
export class SurgeryRequestTussItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id', type: 'uuid' })
  surgeryRequestId: string;

  @Column({ name: 'tuss_code', type: 'varchar', length: 50 })
  tussCode: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ name: 'authorized_quantity', type: 'int', nullable: true })
  authorizedQuantity: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => SurgeryRequest, (sr) => sr.tussItems)
  @JoinColumn({ name: 'surgery_request_id' })
  surgeryRequest: SurgeryRequest;
}
