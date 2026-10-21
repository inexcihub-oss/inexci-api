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
import { User } from './user.entity';
import { FinancialAccount } from './financial-account.entity';

export const CASH_SESSION_ABERTA_UNICA = 'uq_cash_sessions_user_open';

@Entity('cash_sessions')
@Index('idx_cash_sessions_owner_opened_at', ['ownerId', 'openedAt'])
@Index('idx_cash_sessions_user_id', ['userId'])
@Index('idx_cash_sessions_account_id', ['accountId'])
@Index(CASH_SESSION_ABERTA_UNICA, { synchronize: false })
export class CashSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ name: 'opened_at', type: 'timestamptz', default: () => 'now()' })
  openedAt: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({
    name: 'opening_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  openingAmount: string;

  @Column({
    name: 'counted_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  countedAmount: string | null;

  @Column({
    name: 'expected_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  expectedAmount: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  difference: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'closed_by_id', type: 'uuid', nullable: true })
  closedById: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_cash_sessions_owner',
  })
  owner: User;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_cash_sessions_user',
  })
  user: User;

  @ManyToOne(() => FinancialAccount, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'account_id',
    foreignKeyConstraintName: 'FK_cash_sessions_account',
  })
  account: FinancialAccount;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'closed_by_id',
    foreignKeyConstraintName: 'FK_cash_sessions_closed_by',
  })
  closedBy: User | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_cash_sessions_created_by',
  })
  createdBy: User | null;
}
