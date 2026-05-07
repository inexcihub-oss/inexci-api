import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Auditoria de incidentes de PII residual detectada antes da chamada à IA externa.
 * Não armazena o valor original — apenas categoria + hash + flag de bloqueio.
 * Vide Fase 0 (T0.7 / T0.8) do plano `PLANO-MELHORIAS-ENTITIES-IA-WHATSAPP.md`.
 */
@Entity('ai_pii_redaction_log')
@Index('idx_ai_pii_log_category_created', ['category', 'createdAt'])
@Index('idx_ai_pii_log_conversation', ['conversationId'])
export class AiPiiRedactionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId: string | null;

  @Column({ name: 'message_sid', type: 'varchar', length: 64, nullable: true })
  messageSid: string | null;

  @Column({ type: 'varchar', length: 40 })
  category: string;

  @Column({ name: 'value_hash', type: 'varchar', length: 64 })
  valueHash: string;

  @Column({ type: 'boolean', default: false })
  blocked: boolean;

  @Column({ name: 'tool_name', type: 'varchar', length: 100, nullable: true })
  toolName: string | null;

  @Column({ name: 'occurrences', type: 'int', default: 1 })
  occurrences: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
