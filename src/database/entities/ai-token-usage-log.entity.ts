import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('ai_token_usage_logs')
@Index('idx_ai_token_usage_message_sid', ['messageSid'])
@Index('idx_ai_token_usage_conversation_created_at', [
  'conversationId',
  'createdAt',
])
@Index('idx_ai_token_usage_user_created_at', ['userId', 'createdAt'])
@Index('idx_ai_token_usage_created_at', ['createdAt'])
@Index('idx_ai_token_usage_owner', ['ownerId'])
export class AiTokenUsageLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'message_sid', type: 'varchar', length: 64 })
  messageSid: string;

  /**
   * Hash HMAC do telefone (via `hashPhone`). Não é PII e permite agrupar
   * uso por usuário sem armazenar identificador clínico em claro.
   */
  @Column({ name: 'phone_hash', type: 'varchar', length: 64 })
  phoneHash: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId: string | null;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({ name: 'prompt_tokens', type: 'int', default: 0 })
  promptTokens: number;

  @Column({ name: 'completion_tokens', type: 'int', default: 0 })
  completionTokens: number;

  @Column({ name: 'total_tokens', type: 'int', default: 0 })
  totalTokens: number;

  @Column({ name: 'calls_count', type: 'int', default: 0 })
  callsCount: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  model: string | null;

  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs: number | null;

  @Column({ name: 'cost_estimate_cents', type: 'int', nullable: true })
  costEstimateCents: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  breakdown: Array<{
    stage: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    model?: string;
    latencyMs?: number;
  }>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
