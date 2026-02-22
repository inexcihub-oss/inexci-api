import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';
import { User } from './user.entity';

/**
 * Dados de faturamento e recebimento (relação 1:1 com SurgeryRequest).
 * Armazena fatura enviada, recebimento e contestação de pagamento.
 */
@Entity('surgery_request_billing')
export class SurgeryRequestBilling {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: string;

  @Column({ name: 'created_by_id' })
  created_by_id: string;

  // ── Fatura ──────────────────────────────────────
  @Column({ type: 'varchar', length: 100 })
  invoice_protocol: string;

  @Column({ type: 'timestamp' })
  invoice_sent_at: Date;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  invoice_value: number;

  /** Prazo de pagamento (data) — derivado de health_plan.default_payment_days quando não fornecido */
  @Column({ type: 'date', nullable: true })
  payment_deadline: Date;

  // ── Recebimento ─────────────────────────────────
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  received_value: number;

  @Column({ type: 'timestamp', nullable: true })
  received_at: Date;

  @Column({ type: 'text', nullable: true })
  receipt_notes: string;

  // ── Contestação de pagamento ─────────────────────
  /** Preenchido quando received_value ≠ invoice_value */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  contested_received_value: number;

  @Column({ type: 'timestamp', nullable: true })
  contested_received_at: Date;

  @Column({ type: 'text', nullable: true })
  contested_receipt_notes: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  @OneToOne(() => SurgeryRequest, (request) => request.billing)
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'created_by_id' })
  created_by: User;
}
