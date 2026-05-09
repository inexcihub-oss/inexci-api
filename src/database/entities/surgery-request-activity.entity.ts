import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';
import { User } from './user.entity';

/**
 * Tipo de atividade registrada na solicitação cirúrgica
 * - COMMENT: Comentário/anotação manual do usuário
 * - STATUS_CHANGE: Mudança de status automática
 * - SYSTEM: Evento de sistema (envio de email, upload de doc, etc.)
 * - PDF_GENERATED: PDF da solicitação gerado e armazenado automaticamente
 */
export enum ActivityType {
  COMMENT = 'comment',
  STATUS_CHANGE = 'status_change',
  SYSTEM = 'system',
  PDF_GENERATED = 'pdf_generated',
}

@Entity('surgery_request_activities')
export class SurgeryRequestActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id', type: 'uuid' })
  surgeryRequestId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({
    type: 'enum',
    enum: ActivityType,
    default: ActivityType.COMMENT,
  })
  type: ActivityType;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => SurgeryRequest, (request) => request.activities)
  @JoinColumn({ name: 'surgery_request_id' })
  surgeryRequest: SurgeryRequest;

  @ManyToOne(() => User, { nullable: true, eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User | null;
}
