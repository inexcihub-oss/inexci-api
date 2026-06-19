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
@Entity('surgery_request_billings')
export class SurgeryRequestBilling {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id', type: 'uuid' })
  surgeryRequestId: string;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  // ── Fatura ──────────────────────────────────────
  @Column({ name: 'invoice_protocol', type: 'varchar', length: 100 })
  invoiceProtocol: string;

  @Column({ name: 'invoice_sent_at', type: 'timestamp' })
  invoiceSentAt: Date;

  @Column({
    name: 'invoice_value',
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  invoiceValue: number;

  @Column({ name: 'invoice_notes', type: 'text', nullable: true })
  invoiceNotes: string | null;

  /** Prazo de pagamento (data) — derivado de healthPlan.defaultPaymentDays quando não fornecido */
  @Column({ name: 'payment_deadline', type: 'date', nullable: true })
  paymentDeadline: Date | null;

  // ── Recebimento ─────────────────────────────────
  @Column({
    name: 'received_value',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  receivedValue: number | null;

  @Column({ name: 'received_at', type: 'timestamp', nullable: true })
  receivedAt: Date | null;

  @Column({ name: 'receipt_notes', type: 'text', nullable: true })
  receiptNotes: string | null;

  // ── Contestação de pagamento ─────────────────────
  /** Preenchido quando receivedValue ≠ invoiceValue */
  @Column({
    name: 'contested_received_value',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  contestedReceivedValue: number | null;

  @Column({
    name: 'contested_received_at',
    type: 'timestamp',
    nullable: true,
  })
  contestedReceivedAt: Date | null;

  @Column({ name: 'contested_receipt_notes', type: 'text', nullable: true })
  contestedReceiptNotes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ============ RELAÇÕES ============

  @OneToOne(() => SurgeryRequest, (request) => request.billing)
  @JoinColumn({ name: 'surgery_request_id' })
  surgeryRequest: SurgeryRequest;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;
}
