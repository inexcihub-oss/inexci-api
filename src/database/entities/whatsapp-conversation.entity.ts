import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Memória estruturada da conversa, persistida em `conversation_memory`.
 * Mantém slots, fatos confirmados e perguntas em aberto sem precisar
 * reenviar histórico completo ao LLM. Schema flexível para evoluir sem
 * migration.
 */
export interface ConversationMemory {
  intent?: string;
  patient?: {
    id?: string;
    name?: string;
    phone?: string;
  };
  surgery_request?: {
    id?: string;
    status?: string;
    hospital?: string;
    health_plan?: string;
    doctor_id?: string;
  };
  required_slots?: Record<string, string[]>;
  filled_slots?: Record<string, unknown>;
  confirmed_facts?: string[];
  open_questions?: string[];
  pending_actions?: string[];
  last_user_goal?: string;
  last_updated_at?: string;
  /** Contagem de falhas consecutivas em updateSummaryAndMemory. */
  summary_failures?: number;
  [key: string]: unknown;
}

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
  userId: string | null;

  @Column({ name: 'messages_history', type: 'jsonb', default: [] })
  messagesHistory: ConversationMessage[];

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'last_message_at', type: 'timestamptz' })
  lastMessageAt: Date;

  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId: string | null;

  @Column({ name: 'conversation_summary', type: 'text', nullable: true })
  conversationSummary: string | null;

  @Column({
    name: 'conversation_memory',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  conversationMemory: ConversationMemory;

  @Column({ name: 'summary_updated_at', type: 'timestamptz', nullable: true })
  summaryUpdatedAt: Date | null;

  @Column({ name: 'summary_version', type: 'int', default: 1 })
  summaryVersion: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
