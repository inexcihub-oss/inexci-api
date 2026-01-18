import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Cid } from './cid.entity';
import { SurgeryRequestQuotation } from './surgery-request-quotation.entity';
import { OpmeItem } from './opme-item.entity';
import { SurgeryRequestProcedure } from './surgery-request-procedure.entity';
import { Document } from './document.entity';
import { Pendency } from './pendency.entity';
import { Chat } from './chat.entity';
import { StatusUpdate } from './status-update.entity';

@Entity('surgery_request')
export class SurgeryRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'doctor_id' })
  doctor_id: number;

  @Column({ name: 'responsible_id' })
  responsible_id: number;

  @Column({ name: 'hospital_id', nullable: true })
  hospital_id: number;

  @Column({ name: 'patient_id' })
  patient_id: number;

  @Column({ type: 'smallint' })
  status: number;

  @Column({ type: 'boolean' })
  is_indication: boolean;

  @Column({ type: 'varchar', length: 75, nullable: true })
  indication_name: string;

  @Column({ name: 'health_plan_id', nullable: true })
  health_plan_id: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  health_plan_registration: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  health_plan_type: string;

  @Column({ name: 'cid_id', type: 'varchar', length: 75, nullable: true })
  cid_id: string;

  @Column({ type: 'text', nullable: true })
  diagnosis: string;

  @Column({ type: 'text', nullable: true })
  medical_report: string;

  @Column({ type: 'text', nullable: true })
  patient_history: string;

  @Column({ type: 'timestamp', nullable: true })
  surgery_date: Date;

  @Column({ type: 'decimal', precision: 19, scale: 2, nullable: true })
  invoiced_value: number;

  @Column({ type: 'decimal', precision: 19, scale: 2, nullable: true })
  received_value: number;

  @Column({ type: 'timestamp', nullable: true })
  invoiced_date: Date;

  @Column({ type: 'timestamp', nullable: true })
  received_date: Date;

  @Column({ type: 'jsonb', nullable: true })
  date_options: any;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @Column({ type: 'text', nullable: true })
  contest_reason: string;

  @Column({ type: 'timestamp', nullable: true })
  date_call: Date;

  @Column({ type: 'varchar', length: 75, nullable: true })
  protocol: string;

  // Relations
  @ManyToOne(() => User, (user) => user.doctor_requests)
  @JoinColumn({ name: 'doctor_id' })
  doctor: User;

  @ManyToOne(() => User, (user) => user.responsible_requests)
  @JoinColumn({ name: 'responsible_id' })
  responsible: User;

  @ManyToOne(() => User, (user) => user.hospital_requests, { nullable: true })
  @JoinColumn({ name: 'hospital_id' })
  hospital: User;

  @ManyToOne(() => User, (user) => user.patient_requests)
  @JoinColumn({ name: 'patient_id' })
  patient: User;

  @ManyToOne(() => Cid, (cid) => cid.surgery_requests, { nullable: true })
  @JoinColumn({ name: 'cid_id' })
  cid: Cid;

  @ManyToOne(() => User, (user) => user.health_plan_requests, {
    nullable: true,
  })
  @JoinColumn({ name: 'health_plan_id' })
  health_plan: User;

  @OneToMany(
    () => SurgeryRequestQuotation,
    (quotation) => quotation.surgery_request,
  )
  quotations: SurgeryRequestQuotation[];

  @OneToMany(() => OpmeItem, (item) => item.surgery_request)
  opme_items: OpmeItem[];

  @OneToMany(() => SurgeryRequestProcedure, (srp) => srp.surgery_request)
  procedures: SurgeryRequestProcedure[];

  @OneToMany(() => Document, (document) => document.surgery_request)
  documents: Document[];

  @OneToMany(() => Pendency, (pendency) => pendency.surgery_request)
  pendencies: Pendency[];

  @OneToMany(() => Chat, (chat) => chat.surgery_request)
  chats: Chat[];

  @OneToMany(() => StatusUpdate, (statusUpdate) => statusUpdate.surgery_request)
  status_updates: StatusUpdate[];
}
