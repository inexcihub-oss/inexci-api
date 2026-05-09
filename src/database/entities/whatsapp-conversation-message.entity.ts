import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { WhatsappConversation } from './whatsapp-conversation.entity';
import { encryptedTransformer } from '../../shared/crypto/encryption.util';

@Entity('whatsapp_conversation_messages')
@Index('idx_wcm_conversation_created', ['conversationId', 'createdAt'])
export class WhatsappConversationMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ type: 'varchar', length: 20 })
  role: 'user' | 'assistant' | 'tool';

  @Column({ type: 'text', transformer: encryptedTransformer })
  content: string;

  @Column({ name: 'tool_name', type: 'varchar', length: 100, nullable: true })
  toolName: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => WhatsappConversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: WhatsappConversation;
}
