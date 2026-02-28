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
 */
export enum ActivityType {
  COMMENT = 'comment',
  STATUS_CHANGE = 'status_change',
  SYSTEM = 'system',
}

@Entity('surgery_request_activity')
export class SurgeryRequestActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: string;

  @Column({ name: 'user_id', nullable: true })
  user_id: string;

  @Column({
    type: 'enum',
    enum: ActivityType,
    default: ActivityType.COMMENT,
  })
  type: ActivityType;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn()
  created_at: Date;

  // Relations
  @ManyToOne(() => SurgeryRequest, (request) => request.activities)
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;

  @ManyToOne(() => User, { nullable: true, eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
