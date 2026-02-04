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
 * Cotação de OPME para uma solicitação cirúrgica
 */
@Entity('surgery_request_quotation')
export class SurgeryRequestQuotation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: string;

  @Column({ name: 'supplier_id' })
  supplier_id: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  proposal_number: string;

  @Column({ type: 'decimal', precision: 19, scale: 2, nullable: true })
  total_value: number;

  @Column({ type: 'date', nullable: true })
  submission_date: Date;

  @Column({ type: 'date', nullable: true })
  valid_until: Date;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'boolean', default: false })
  selected: boolean; // Se esta cotação foi selecionada

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  @ManyToOne(() => SurgeryRequest, (request) => request.quotations)
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;

  @ManyToOne(() => Supplier, (supplier) => supplier.quotations)
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;
}
