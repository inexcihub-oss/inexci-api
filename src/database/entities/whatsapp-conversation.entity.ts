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
import { OperationDraft } from '../../shared/ai/drafts/operation-draft.types';

/**
 * Memória estruturada da conversa, persistida em `conversationMemory`.
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
  surgeryRequest?: {
    id?: string;
    status?: string;
    hospital?: string;
    healthPlan?: string;
    doctorId?: string;
  };
  required_slots?: Record<string, string[]>;
  filled_slots?: Record<string, unknown>;
  confirmed_facts?: string[];
  open_questions?: string[];
  pending_actions?: string[];
  last_user_goal?: string;
  last_updated_at?: string;
  /**
   * Operação aguardando confirmação explícita do usuário ("sim"/"confirmo").
   * Gravado pelo orchestrator após o LLM chamar uma tool de mutação com
   * `confirm: false` (preview). Lido no turno seguinte para re-executar a
   * tool com `confirm: true` quando o usuário confirma — evita o LLM
   * "esquecer" o que ele acabou de propor.
   */
  pending_confirmation?: {
    tool: string;
    args: Record<string, unknown>;
    description: string;
    createdAt: string;
  } | null;
  /** Contagem de falhas consecutivas em updateSummaryAndMemory. */
  summary_failures?: number;
  [key: string]: unknown;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  toolName?: string;
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

@Entity('whatsapp_conversations')
@Index('idx_wc_phone', ['phone'])
@Index('idx_wc_active', ['active', 'lastMessageAt'])
@Index('idx_wc_owner', ['ownerId'])
export class WhatsappConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  phone: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'last_message_at', type: 'timestamptz' })
  lastMessageAt: Date;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({ name: 'conversation_summary', type: 'text', nullable: true })
  conversationSummary: string | null;

  @Column({
    name: 'conversation_memory',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  conversationMemory: ConversationMemory;

  /**
   * Draft estruturado da operação em andamento (criação de SC, cadastro,
   * faturamento, contestação, agendamento, atualização). Schema discriminado
   * por `type`. Quando `null`, não há operação ativa.
   */
  @Column({ name: 'operation_draft', type: 'jsonb', nullable: true })
  operationDraft: OperationDraft | null;

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
  user: User | null;
}
