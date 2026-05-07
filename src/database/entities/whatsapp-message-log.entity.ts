import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { WhatsappConversation } from './whatsapp-conversation.entity';

export enum WhatsappMessageStatus {
  SENT = 'sent',
  FAILED = 'failed',
  QUEUED = 'queued',
  DELIVERED = 'delivered',
  READ = 'read',
}

export enum WhatsappMessageDirection {
  OUTBOUND = 'outbound',
  INBOUND = 'inbound',
}

export enum WhatsappMessageType {
  FREEFORM = 'freeform',
  TEMPLATE = 'template',
  AI = 'ai',
}

@Entity('whatsapp_message_log')
@Index('idx_wml_message_sid', ['messageSid'])
@Index('idx_wml_to_created', ['to', 'createdAt'])
@Index('idx_wml_status_created', ['status', 'createdAt'])
export class WhatsappMessageLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  to: string;

  @Column({ type: 'text' })
  body: string;

  @Column({
    type: 'enum',
    enum: WhatsappMessageStatus,
    default: WhatsappMessageStatus.SENT,
  })
  status: WhatsappMessageStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'message_sid', type: 'varchar', length: 64, nullable: true })
  messageSid: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId: string | null;

  @Column({
    type: 'varchar',
    length: 10,
    default: WhatsappMessageDirection.OUTBOUND,
  })
  direction: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: WhatsappMessageType.FREEFORM,
  })
  type: string;

  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => WhatsappConversation, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation: WhatsappConversation;
}
