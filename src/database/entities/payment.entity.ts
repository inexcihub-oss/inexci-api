import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Receivable } from './receivable.entity';
import { FinancialAccount } from './financial-account.entity';
import { CashSession } from './cash-session.entity';
import { PaymentMethod } from './payment-method-config.entity';
import { Refund } from './refund.entity';

export const PAYMENT_IDEMPOTENCY_KEY_UNICA =
  'uq_payments_owner_idempotency_key';

@Entity('payments')
@Index('idx_payments_owner_paid_at', ['ownerId', 'paidAt'])
@Index('idx_payments_cash_session_id', ['cashSessionId'])
@Index('idx_payments_receivable_id', ['receivableId'])
@Index('idx_payments_account_id', ['accountId'])
@Index(PAYMENT_IDEMPOTENCY_KEY_UNICA, { synchronize: false })
@Check('CHK_payments_amount_positive', '"amount" > 0')
@Check(
  'CHK_payments_refunded_amount_range',
  '"refunded_amount" >= 0 AND "refunded_amount" <= "amount"',
)
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'receivable_id', type: 'uuid' })
  receivableId: string;

  @Column({ type: 'varchar', length: 20 })
  method: PaymentMethod;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({
    name: 'refunded_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  refundedAmount: string;

  @Column({ name: 'paid_at', type: 'timestamptz' })
  paidAt: Date;

  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId: string | null;

  @Column({ name: 'cash_session_id', type: 'uuid', nullable: true })
  cashSessionId: string | null;

  @Column({ name: 'received_by_id', type: 'uuid', nullable: true })
  receivedById: string | null;

  @Column({ name: 'card_brand', type: 'varchar', length: 30, nullable: true })
  cardBrand: string | null;

  @Column({ type: 'int', default: 1 })
  installments: number;

  @Column({ type: 'varchar', length: 40, nullable: true })
  nsu: string | null;

  @Column({
    name: 'authorization_code',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  authorizationCode: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'idempotency_key', type: 'uuid', nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_payments_owner',
  })
  owner: User;

  @ManyToOne(() => Receivable, (receivable) => receivable.payments, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'receivable_id',
    foreignKeyConstraintName: 'FK_payments_receivable',
  })
  receivable: Receivable;

  @ManyToOne(() => FinancialAccount, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'account_id',
    foreignKeyConstraintName: 'FK_payments_account',
  })
  account: FinancialAccount | null;

  @ManyToOne(() => CashSession, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'cash_session_id',
    foreignKeyConstraintName: 'FK_payments_cash_session',
  })
  cashSession: CashSession | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'received_by_id',
    foreignKeyConstraintName: 'FK_payments_received_by',
  })
  receivedBy: User | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_payments_created_by',
  })
  createdBy: User | null;

  @OneToMany(() => Refund, (refund) => refund.payment)
  refunds: Refund[];
}
