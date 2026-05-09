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
import { Supplier } from './supplier.entity';

/**
 * Cotação de OPME para uma solicitação cirúrgica.
 */
@Entity('surgery_request_quotations')
export class SurgeryRequestQuotation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id', type: 'uuid' })
  surgeryRequestId: string;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  @Column({
    name: 'proposal_number',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  proposalNumber: string | null;

  @Column({
    name: 'total_value',
    type: 'decimal',
    precision: 19,
    scale: 2,
    nullable: true,
  })
  totalValue: number | null;

  @Column({ name: 'submission_date', type: 'date', nullable: true })
  submissionDate: Date | null;

  @Column({ name: 'valid_until', type: 'date', nullable: true })
  validUntil: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Indica se esta cotação foi a escolhida. */
  @Column({ type: 'boolean', default: false })
  selected: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ============ RELAÇÕES ============

  @ManyToOne(() => SurgeryRequest, (request) => request.quotations)
  @JoinColumn({ name: 'surgery_request_id' })
  surgeryRequest: SurgeryRequest;

  @ManyToOne(() => Supplier, (supplier) => supplier.quotations)
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;
}
