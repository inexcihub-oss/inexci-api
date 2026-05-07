import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { WhatsappConversation } from './whatsapp-conversation.entity';

export enum NotificationChannel {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
}

export enum NotificationSendStatus {
  QUEUED = 'queued',
  SENT = 'sent',
  FAILED = 'failed',
  DELIVERED = 'delivered',
  READ = 'read',
}

export enum NotificationDirection {
  OUTBOUND = 'outbound',
  INBOUND = 'inbound',
}

export enum NotificationSendType {
  FREEFORM = 'freeform',
  TEMPLATE = 'template',
  AI = 'ai',
}

@Entity('notification_send_log')
@Index(['channel', 'status'])
@Index(['created_at'])
@Index('idx_nsl_account', ['accountId'])
@Index('idx_nsl_message_sid', ['messageSid'])
export class NotificationSendLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: NotificationChannel })
  channel: NotificationChannel;

  @Column({
    type: 'enum',
    enum: NotificationSendStatus,
    default: NotificationSendStatus.QUEUED,
  })
  status: NotificationSendStatus;

  @Column({ type: 'varchar', length: 255 })
  to: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subject: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  template: string | null;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  job_id: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  sent_at: Date | null;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ name: 'message_sid', type: 'varchar', length: 64, nullable: true })
  messageSid: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId: string | null;

  @Column({
    type: 'varchar',
    length: 10,
    nullable: true,
    default: NotificationDirection.OUTBOUND,
  })
  direction: string | null;

  @Column({
    name: 'notification_type',
    type: 'varchar',
    length: 20,
    nullable: true,
    default: NotificationSendType.FREEFORM,
  })
  notificationType: string | null;

  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

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
