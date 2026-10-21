import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Payment } from './payment.entity';
import { FinancialAccount } from './financial-account.entity';
import { CashSession } from './cash-session.entity';

export enum RefundReason {
  DUPLICATE_ENTRY = 'duplicate_entry',
  WRONG_AMOUNT = 'wrong_amount',
  WRONG_PAYMENT_METHOD = 'wrong_payment_method',
  WRONG_PATIENT = 'wrong_patient',
  SERVICE_NOT_PERFORMED = 'service_not_performed',
  UNDUE_CHARGE = 'undue_charge',
  PATIENT_REQUEST = 'patient_request',
  COURTESY_DISCOUNT = 'courtesy_discount',
  SERVICE_CHANGE = 'service_change',
  SWITCHED_TO_HEALTH_PLAN = 'switched_to_health_plan',
  PATIENT_RESCHEDULING = 'patient_rescheduling',
  FUTURE_CREDIT = 'future_credit',
  OTHER = 'other',
}

export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  [RefundReason.DUPLICATE_ENTRY]: 'Lançamento duplicado',
  [RefundReason.WRONG_AMOUNT]: 'Erro no valor lançado',
  [RefundReason.WRONG_PAYMENT_METHOD]: 'Erro na forma de pagamento',
  [RefundReason.WRONG_PATIENT]: 'Paciente errado',
  [RefundReason.SERVICE_NOT_PERFORMED]: 'Procedimento ou exame não realizado',
  [RefundReason.UNDUE_CHARGE]: 'Cobrança indevida',
  [RefundReason.PATIENT_REQUEST]: 'Solicitação do paciente',
  [RefundReason.COURTESY_DISCOUNT]: 'Cortesia ou desconto comercial',
  [RefundReason.SERVICE_CHANGE]:
    'Troca de procedimento, exame ou especialidade',
  [RefundReason.SWITCHED_TO_HEALTH_PLAN]: 'Atendimento virou convênio ou plano',
  [RefundReason.PATIENT_RESCHEDULING]: 'Paciente cancelou e vai remarcar',
  [RefundReason.FUTURE_CREDIT]: 'Crédito intencional para uso futuro',
  [RefundReason.OTHER]: 'Outro motivo',
};

@Entity('refunds')
@Index('idx_refunds_payment_id', ['paymentId'])
@Index('idx_refunds_owner_created_at', ['ownerId', 'createdAt'])
@Index('idx_refunds_cash_session_id', ['cashSessionId'])
@Check('CHK_refunds_amount_positive', '"amount" > 0')
export class Refund {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 40 })
  reason: RefundReason;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId: string | null;

  @Column({ name: 'cash_session_id', type: 'uuid', nullable: true })
  cashSessionId: string | null;

  @Column({ name: 'refunded_by_id', type: 'uuid', nullable: true })
  refundedById: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_refunds_owner',
  })
  owner: User;

  @ManyToOne(() => Payment, (payment) => payment.refunds, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'payment_id',
    foreignKeyConstraintName: 'FK_refunds_payment',
  })
  payment: Payment;

  @ManyToOne(() => FinancialAccount, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'account_id',
    foreignKeyConstraintName: 'FK_refunds_account',
  })
  account: FinancialAccount | null;

  @ManyToOne(() => CashSession, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'cash_session_id',
    foreignKeyConstraintName: 'FK_refunds_cash_session',
  })
  cashSession: CashSession | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'refunded_by_id',
    foreignKeyConstraintName: 'FK_refunds_refunded_by',
  })
  refundedBy: User | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_refunds_created_by',
  })
  createdBy: User | null;
}
