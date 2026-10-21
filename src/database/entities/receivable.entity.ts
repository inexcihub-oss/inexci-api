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
import { Patient } from './patient.entity';
import { Appointment } from './appointment.entity';
import { ReceivableItem } from './receivable-item.entity';
import { Payment } from './payment.entity';

export enum ReceivableStatus {
  OPEN = 'open',
  PARTIAL = 'partial',
  PAID = 'paid',
  CANCELLED = 'cancelled',
}

export const RECEIVABLE_ATIVA_POR_CONSULTA =
  'uq_receivables_appointment_active';

@Entity('receivables')
@Index('idx_receivables_owner_status_due_date', [
  'ownerId',
  'status',
  'dueDate',
])
@Index('idx_receivables_patient_id', ['patientId'])
@Index('idx_receivables_appointment_id', ['appointmentId'])
@Index('idx_receivables_owner_reference_date', ['ownerId', 'referenceDate'])
@Index(RECEIVABLE_ATIVA_POR_CONSULTA, { synchronize: false })
@Check('CHK_receivables_paid_amount_non_negative', '"paid_amount" >= 0')
export class Receivable {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @Column({ name: 'appointment_id', type: 'uuid', nullable: true })
  appointmentId: string | null;

  @Column({ name: 'reference_date', type: 'date' })
  referenceDate: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({
    name: 'total_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  totalAmount: string;

  @Column({
    name: 'paid_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  paidAmount: string;

  @Column({ type: 'varchar', length: 20, default: ReceivableStatus.OPEN })
  status: ReceivableStatus;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason: string | null;

  @Column({ name: 'cancelled_by_id', type: 'uuid', nullable: true })
  cancelledById: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_receivables_owner',
  })
  owner: User;

  @ManyToOne(() => Patient, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'patient_id',
    foreignKeyConstraintName: 'FK_receivables_patient',
  })
  patient: Patient;

  @ManyToOne(() => Appointment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'appointment_id',
    foreignKeyConstraintName: 'FK_receivables_appointment',
  })
  appointment: Appointment | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'cancelled_by_id',
    foreignKeyConstraintName: 'FK_receivables_cancelled_by',
  })
  cancelledBy: User | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_receivables_created_by',
  })
  createdBy: User | null;

  @OneToMany(() => ReceivableItem, (item) => item.receivable)
  items: ReceivableItem[];

  @OneToMany(() => Payment, (payment) => payment.receivable)
  payments: Payment[];
}
