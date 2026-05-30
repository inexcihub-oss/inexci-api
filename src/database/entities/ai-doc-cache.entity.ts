import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Cache de OCR + classificação por SHA256 do conteúdo binário do
 * documento (Fase 5 do Blueprint v3).
 *
 * Não armazena PII em texto livre — `ocr_text` é o texto **tokenizado
 * pelo `PiiVaultService`** (CPF/telefone/e-mail viram `{{categoria_n}}`).
 * Conteúdo plain text bruto NUNCA é cacheado.
 */
@Entity('ai_doc_cache')
@Index('idx_ai_doc_cache_created_at', ['createdAt'])
@Index('idx_ai_doc_cache_last_hit_at', ['lastHitAt'])
export class AiDocCache {
  @PrimaryColumn({ type: 'char', length: 64 })
  sha256: string;

  @Column({ type: 'text' })
  mime: string;

  @Column({ name: 'byte_size', type: 'int' })
  byteSize: number;

  @Column({ name: 'ocr_text', type: 'text', nullable: true })
  ocrText: string | null;

  @Column({
    name: 'ocr_confidence',
    type: 'numeric',
    precision: 3,
    scale: 2,
    nullable: true,
    transformer: {
      to: (v: number | null) => v,
      from: (v: string | null) => (v == null ? null : Number(v)),
    },
  })
  ocrConfidence: number | null;

  @Column({ type: 'jsonb', nullable: true })
  classification: Record<string, unknown> | null;

  /** Resultado do `DocumentExtractionEngine` (parsers + confidence). */
  @Column({ type: 'jsonb', nullable: true })
  extraction: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({
    name: 'last_hit_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastHitAt: Date;

  @Column({ name: 'hit_count', type: 'int', default: 0 })
  hitCount: number;
}
