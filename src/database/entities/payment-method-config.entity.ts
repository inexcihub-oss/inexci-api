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

export enum PaymentMethod {
  CASH = 'cash',
  PIX = 'pix',
  CREDIT_CARD = 'credit_card',
  DEBIT_CARD = 'debit_card',
  BANK_TRANSFER = 'bank_transfer',
  BOLETO = 'boleto',
  CHECK = 'check',
  OTHER = 'other',
}

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.CASH,
  PaymentMethod.PIX,
  PaymentMethod.CREDIT_CARD,
  PaymentMethod.DEBIT_CARD,
  PaymentMethod.BANK_TRANSFER,
  PaymentMethod.BOLETO,
  PaymentMethod.CHECK,
  PaymentMethod.OTHER,
];

export const PAYMENT_METHODS_ATIVOS_POR_PADRAO: readonly PaymentMethod[] = [
  PaymentMethod.CASH,
  PaymentMethod.PIX,
  PaymentMethod.CREDIT_CARD,
  PaymentMethod.DEBIT_CARD,
];

export const MAX_INSTALLMENTS_LIMIT = 24;

export const PAYMENT_METHOD_CONFIG_UNICA =
  'uq_payment_method_configs_owner_method';

@Entity('payment_method_configs')
@Index('idx_payment_method_configs_updated_by_id', ['updatedById'])
@Index(PAYMENT_METHOD_CONFIG_UNICA, ['ownerId', 'method'], { unique: true })
@Index('idx_payment_method_configs_default_account_id', ['defaultAccountId'])
@Check(
  'CHK_payment_method_configs_max_installments',
  '"max_installments" BETWEEN 1 AND 24',
)
export class PaymentMethodConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'varchar', length: 20 })
  method: PaymentMethod;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'default_account_id', type: 'uuid', nullable: true })
  defaultAccountId: string | null;

  @Column({ name: 'max_installments', type: 'int', default: 1 })
  maxInstallments: number;

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
    foreignKeyConstraintName: 'FK_payment_method_configs_owner',
  })
  owner: User;

  @ManyToOne(() => FinancialAccount, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'default_account_id',
    foreignKeyConstraintName: 'FK_payment_method_configs_default_account',
  })
  defaultAccount: FinancialAccount | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_payment_method_configs_created_by',
  })
  createdBy: User | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'updated_by_id',
    foreignKeyConstraintName: 'FK_payment_method_configs_updated_by',
  })
  updatedBy: User | null;
}
