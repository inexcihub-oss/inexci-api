import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { User } from './user.entity';
import { FinancialAccount } from './financial-account.entity';
import { CashSession } from './cash-session.entity';
import { Payment } from './payment.entity';
import { Refund } from './refund.entity';

export enum FinancialEntryDirection {
  IN = 'in',
  OUT = 'out',
}

export enum FinancialEntryKind {
  PAYMENT = 'payment',
  REFUND = 'refund',
  WITHDRAWAL = 'withdrawal',
  SUPPLY = 'supply',
  SESSION_CLOSING = 'session_closing',
  TRANSFER = 'transfer',
  ADJUSTMENT = 'adjustment',
}

export const FINANCIAL_ENTRY_DESTINO_UNICO =
  'CHK_financial_entries_account_xor_cash_session';
export const FINANCIAL_ENTRY_VALOR_POSITIVO =
  'CHK_financial_entries_amount_positive';

@Entity('financial_entries')
@Index('idx_financial_entries_account_occurred_at', ['accountId', 'occurredAt'])
@Index('idx_financial_entries_cash_session_id', ['cashSessionId'])
@Index('idx_financial_entries_owner_occurred_at', ['ownerId', 'occurredAt'])
@Index('idx_financial_entries_payment_id', ['paymentId'])
@Index('idx_financial_entries_refund_id', ['refundId'])
@Index('idx_financial_entries_counterpart_entry_id', ['counterpartEntryId'])
@Check(
  FINANCIAL_ENTRY_DESTINO_UNICO,
  '("account_id" IS NOT NULL) <> ("cash_session_id" IS NOT NULL)',
)
@Check(FINANCIAL_ENTRY_VALOR_POSITIVO, '"amount" > 0')
export class FinancialEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId: string | null;

  @Column({ name: 'cash_session_id', type: 'uuid', nullable: true })
  cashSessionId: string | null;

  @Column({ type: 'varchar', length: 3 })
  direction: FinancialEntryDirection;

  @Column({ type: 'varchar', length: 20 })
  kind: FinancialEntryKind;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId: string | null;

  @Column({ name: 'refund_id', type: 'uuid', nullable: true })
  refundId: string | null;

  @Column({ name: 'counterpart_entry_id', type: 'uuid', nullable: true })
  counterpartEntryId: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_financial_entries_owner',
  })
  owner: User;

  @ManyToOne(() => FinancialAccount, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'account_id',
    foreignKeyConstraintName: 'FK_financial_entries_account',
  })
  account: FinancialAccount | null;

  @ManyToOne(() => CashSession, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'cash_session_id',
    foreignKeyConstraintName: 'FK_financial_entries_cash_session',
  })
  cashSession: CashSession | null;

  @ManyToOne(() => Payment, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'payment_id',
    foreignKeyConstraintName: 'FK_financial_entries_payment',
  })
  payment: Payment | null;

  @ManyToOne(() => Refund, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'refund_id',
    foreignKeyConstraintName: 'FK_financial_entries_refund',
  })
  refund: Refund | null;

  @ManyToOne(() => FinancialEntry, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'counterpart_entry_id',
    foreignKeyConstraintName: 'FK_financial_entries_counterpart_entry',
  })
  counterpartEntry: FinancialEntry | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_financial_entries_created_by',
  })
  createdBy: User | null;
}
