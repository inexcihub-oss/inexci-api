import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';
import { User } from './user.entity';
import { Contestation } from './contestation.entity';

@Entity('document')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: string;

  @Column({ name: 'created_by' })
  created_by: string;

  /** Tipo do documento (ex: 'personal_document', 'doctor_request', etc.) */
  @Column({ type: 'varchar', length: 75 })
  type: string;

  @Column({ type: 'varchar', length: 50 })
  key: string;

  @Column({ type: 'varchar', length: 75 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  uri: string;

  /** FK para contestação (nullable) — documentos anexados a uma contestação */
  @Column({ name: 'contestation_id', nullable: true })
  contestation_id: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Relations
  @ManyToOne(() => SurgeryRequest, (request) => request.documents)
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;

  @ManyToOne(() => User, (user) => user.inserted_documents)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @ManyToOne(() => Contestation, (contestation) => contestation.documents, {
    nullable: true,
  })
  @JoinColumn({ name: 'contestation_id' })
  contestation: Contestation;
}
