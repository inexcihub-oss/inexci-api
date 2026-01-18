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
import { User } from './user.entity';

@Entity('surgery_request_quotation')
export class SurgeryRequestQuotation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: number;

  @Column({ name: 'supplier_id' })
  supplier_id: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  proposal_number: string;

  @Column({ type: 'date', nullable: true })
  submission_date: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Relations
  @ManyToOne(() => SurgeryRequest, (request) => request.quotations)
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;

  @ManyToOne(() => User, (user) => user.quotations)
  @JoinColumn({ name: 'supplier_id' })
  supplier: User;
}
