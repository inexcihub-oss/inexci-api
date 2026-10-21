import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Payment } from './payment.entity';

@Entity('payment_receipt_issues')
@Index('idx_payment_receipt_issues_payment_id', ['paymentId'])
@Index('idx_payment_receipt_issues_issued_by_id', ['issuedById'])
export class PaymentReceiptIssue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId: string;

  @Column({ name: 'issued_by_id', type: 'uuid', nullable: true })
  issuedById: string | null;

  @Column({ name: 'with_signature', type: 'boolean', default: false })
  withSignature: boolean;

  @Column({
    name: 'issued_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  issuedAt: Date;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_payment_receipt_issues_owner',
  })
  owner: User;

  @ManyToOne(() => Payment, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'payment_id',
    foreignKeyConstraintName: 'FK_payment_receipt_issues_payment',
  })
  payment: Payment;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'issued_by_id',
    foreignKeyConstraintName: 'FK_payment_receipt_issues_issued_by',
  })
  issuedBy: User | null;
}
