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
import { Clinic } from './clinic.entity';
import { SurgeryRequest } from './surgery-request.entity';
import { Document } from './document.entity';
import { Pendency } from './pendency.entity';
import { Chat } from './chat.entity';
import { ChatMessage } from './chat-message.entity';
import { SurgeryRequestQuotation } from './surgery-request-quotation.entity';
import { RecoveryCode } from './recovery-code.entity';
import { DefaultDocumentClinic } from './default-document-clinic.entity';

@Entity('user')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'clinic_id', nullable: true })
  clinic_id: number;

  @Column({ type: 'smallint' })
  status: number;

  @Column({ type: 'smallint' })
  pv: number;

  @Column({ type: 'varchar', length: 75 })
  email: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  password: string;

  @Column({ type: 'varchar', length: 75 })
  name: string;

  @Column({ type: 'char', length: 11, nullable: true })
  phone: string;

  @Column({ type: 'char', length: 1, nullable: true })
  gender: string;

  @Column({ type: 'date', nullable: true })
  birth_date: Date;

  @Column({ type: 'varchar', length: 14, nullable: true })
  document: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  company: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Relations
  @ManyToOne(() => Clinic, (clinic) => clinic.users, { nullable: true })
  @JoinColumn({ name: 'clinic_id' })
  clinic: Clinic;

  @OneToMany(() => SurgeryRequestQuotation, (quotation) => quotation.supplier)
  quotations: SurgeryRequestQuotation[];

  @OneToMany(() => SurgeryRequest, (request) => request.doctor)
  doctor_requests: SurgeryRequest[];

  @OneToMany(() => SurgeryRequest, (request) => request.responsible)
  responsible_requests: SurgeryRequest[];

  @OneToMany(() => SurgeryRequest, (request) => request.hospital)
  hospital_requests: SurgeryRequest[];

  @OneToMany(() => SurgeryRequest, (request) => request.patient)
  patient_requests: SurgeryRequest[];

  @OneToMany(() => SurgeryRequest, (request) => request.health_plan)
  health_plan_requests: SurgeryRequest[];

  @OneToMany(() => Document, (document) => document.creator)
  inserted_documents: Document[];

  @OneToMany(() => Pendency, (pendency) => pendency.responsible)
  pendencies: Pendency[];

  @OneToMany(() => Chat, (chat) => chat.user)
  chats: Chat[];

  @OneToMany(() => ChatMessage, (message) => message.sender)
  sent_messages: ChatMessage[];

  @OneToMany(() => RecoveryCode, (code) => code.user)
  recovery_code: RecoveryCode[];

  @OneToMany(() => DefaultDocumentClinic, (document) => document.creator)
  default_document_clinic: DefaultDocumentClinic[];
}
