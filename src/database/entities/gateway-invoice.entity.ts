import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

export type GatewayInvoiceStatus =
  | 'draft'
  | 'open'
  | 'paid'
  | 'void'
  | 'uncollectible';

@Entity('gateway_invoices')
@Unique('UQ_gateway_invoices_gateway_invoice_id', ['gatewayInvoiceId'])
@Index('idx_gateway_invoices_owner_created', ['ownerId', 'invoiceCreatedAt'])
@Index('idx_gateway_invoices_status_paid', ['status', 'paidAt'])
export class GatewayInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'gateway_provider', type: 'varchar', length: 30 })
  gatewayProvider: string;

  @Column({
    name: 'gateway_invoice_id',
    type: 'varchar',
    length: 100,
  })
  gatewayInvoiceId: string;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({ name: 'subscription_id', type: 'uuid', nullable: true })
  subscriptionId: string | null;

  @Column({
    name: 'gateway_customer_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  gatewayCustomerId: string | null;

  @Column({
    name: 'gateway_subscription_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  gatewaySubscriptionId: string | null;

  @Column({ type: 'varchar', length: 20 })
  status: GatewayInvoiceStatus;

  @Column({ name: 'amount_due_cents', type: 'int', default: 0 })
  amountDueCents: number;

  @Column({ name: 'amount_paid_cents', type: 'int', default: 0 })
  amountPaidCents: number;

  @Column({ name: 'amount_discount_cents', type: 'int', default: 0 })
  amountDiscountCents: number;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ name: 'period_start', type: 'timestamptz', nullable: true })
  periodStart: Date | null;

  @Column({ name: 'period_end', type: 'timestamptz', nullable: true })
  periodEnd: Date | null;

  @Column({ name: 'due_date', type: 'timestamptz', nullable: true })
  dueDate: Date | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'invoice_created_at', type: 'timestamptz' })
  invoiceCreatedAt: Date;

  @Column({ name: 'hosted_invoice_url', type: 'text', nullable: true })
  hostedInvoiceUrl: string | null;

  @Column({
    name: 'coupon_code',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  couponCode: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'owner_id' })
  owner: User | null;
}
