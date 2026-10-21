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

export enum FinancialAccountType {
  CASH_DRAWER = 'cash_drawer',
  BANK = 'bank',
  CARD_CREDIT = 'card_credit',
  CARD_DEBIT = 'card_debit',
  OTHER = 'other',
}

@Entity('financial_accounts')
@Index('idx_financial_accounts_updated_by_id', ['updatedById'])
@Index('idx_financial_accounts_owner_id', ['ownerId'])
@Index('idx_financial_accounts_created_by_id', ['createdById'])
export class FinancialAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  type: FinancialAccountType;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_financial_accounts_owner',
  })
  owner: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_financial_accounts_created_by',
  })
  createdBy: User | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'updated_by_id',
    foreignKeyConstraintName: 'FK_financial_accounts_updated_by',
  })
  updatedBy: User | null;
}
