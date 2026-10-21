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
import { Appointment } from './appointment.entity';
import { Receivable } from './receivable.entity';

@Entity('receivable_items')
@Index('idx_receivable_items_receivable_id', ['receivableId'])
@Index('idx_receivable_items_executed_by_executed_at', [
  'executedById',
  'executedAt',
])
@Index('idx_receivable_items_appointment_id', ['appointmentId'])
@Check('CHK_receivable_items_quantity_positive', '"quantity" >= 1')
@Check('CHK_receivable_items_discount_non_negative', '"discount" >= 0')
@Check('CHK_receivable_items_surcharge_non_negative', '"surcharge" >= 0')
export class ReceivableItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'receivable_id', type: 'uuid' })
  receivableId: string;

  @Column({ name: 'appointment_id', type: 'uuid', nullable: true })
  appointmentId: string | null;

  @Column({ type: 'varchar', length: 150 })
  description: string;

  @Column({ name: 'executed_by_id', type: 'uuid', nullable: true })
  executedById: string | null;

  @Column({ name: 'executed_at', type: 'date', nullable: true })
  executedAt: string | null;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ name: 'unit_amount', type: 'numeric', precision: 12, scale: 2 })
  unitAmount: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  discount: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  surcharge: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  total: string;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancelled_by_id', type: 'uuid', nullable: true })
  cancelledById: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_receivable_items_owner',
  })
  owner: User;

  @ManyToOne(() => Receivable, (receivable) => receivable.items, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'receivable_id',
    foreignKeyConstraintName: 'FK_receivable_items_receivable',
  })
  receivable: Receivable;

  @ManyToOne(() => Appointment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'appointment_id',
    foreignKeyConstraintName: 'FK_receivable_items_appointment',
  })
  appointment: Appointment | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'executed_by_id',
    foreignKeyConstraintName: 'FK_receivable_items_executed_by',
  })
  executedBy: User | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'cancelled_by_id',
    foreignKeyConstraintName: 'FK_receivable_items_cancelled_by',
  })
  cancelledBy: User | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_receivable_items_created_by',
  })
  createdBy: User | null;
}
