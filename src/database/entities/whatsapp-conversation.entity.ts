import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  tool_name?: string;
  metadata?: {
    source?: 'text' | 'audio' | 'text+audio';
    transcription?: {
      text: string;
      provider: 'faster_whisper' | 'openai';
      language?: string | null;
      confidence?: number | null;
      durationSeconds?: number | null;
      latencyMs?: number;
      fallbackUsed?: boolean;
    };
    inboundMedia?: Array<{
      url: string;
      contentType: string | null;
      category?: 'audio' | 'other';
      durationSeconds?: number | null;
      sizeBytes?: number;
    }>;
  };
}

@Entity('whatsapp_conversation')
export class WhatsappConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  phone: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  user_id: string | null;

  @Column({ type: 'jsonb', default: [] })
  messages_history: ConversationMessage[];

  @Column({ name: 'started_at', type: 'timestamptz' })
  started_at: Date;

  @Column({ name: 'last_message_at', type: 'timestamptz' })
  last_message_at: Date;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
