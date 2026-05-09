import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

import { Subscription } from './subscription.entity';

/**
 * Status normalizado da fatura.
 * Mapeado a partir do gateway (vide `payment-gateway.types.ts`).
 */
export enum InvoiceStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  OVERDUE = 'overdue',
  REFUNDED = 'refunded',
  CANCELED = 'canceled',
}

/**
 * Fatura/cobran\u00e7a gerada pelo gateway para uma assinatura.
 *
 * \u00c9 a fonte da verdade local para o hist\u00f3rico de cobran\u00e7as exibido na UI.
 * Atualizada via webhook do gateway (PAYMENT_CONFIRMED, PAYMENT_OVERDUE etc.).
 */
@Entity('invoices')
@Index('idx_invoices_owner_id', ['ownerId'])
@Index('idx_invoices_subscription_id', ['subscriptionId'])
@Index('idx_invoices_gateway_invoice_id', ['gatewayInvoiceId'], {
  unique: true,
})
@Index('idx_invoices_status', ['status'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'amount_cents', type: 'int' })
  amountCents: number;

  @Column({ type: 'varchar', length: 3, default: 'BRL' })
  currency: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: InvoiceStatus.PENDING,
  })
  status: InvoiceStatus;

  @Column({ name: 'gateway_provider', type: 'varchar', length: 30 })
  gatewayProvider: string;

  @Column({
    name: 'gateway_invoice_id',
    type: 'varchar',
    length: 100,
  })
  gatewayInvoiceId: string;

  @Column({ name: 'invoice_url', type: 'varchar', length: 500, nullable: true })
  invoiceUrl: string | null;

  @Column({ name: 'due_date', type: 'timestamptz' })
  dueDate: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt: Date | null;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount: number;

  /** In\u00edcio do per\u00edodo coberto por esta fatura. */
  @Column({ name: 'period_start', type: 'timestamptz' })
  periodStart: Date;

  /** Fim do per\u00edodo coberto por esta fatura. */
  @Column({ name: 'period_end', type: 'timestamptz' })
  periodEnd: Date;

  /**
   * Snapshot do plano no momento da emiss\u00e3o (slug + nome + pre\u00e7o).
   * Garante que o hist\u00f3rico de faturas continue correto mesmo se o plano
   * for renomeado ou tiver o pre\u00e7o alterado depois.
   */
  @Column({ name: 'plan_snapshot', type: 'jsonb', nullable: true })
  planSnapshot: {
    slug: string;
    name: string;
    priceCents: number;
    surgeryRequestQuota: number;
  } | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Subscription, (s) => s.invoices, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;
}
