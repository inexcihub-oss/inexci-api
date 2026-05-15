import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type AiPersistentMemoryScope =
  | 'preference'
  | 'entity'
  | 'pattern'
  | 'goal';

@Entity('ai_persistent_memory')
@Index('idx_apm_user_lastused', ['userId', 'lastUsedAt'])
@Index('idx_apm_scope', ['scope'])
export class AiPersistentMemory {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ type: 'text' })
  scope: AiPersistentMemoryScope;

  @PrimaryColumn({ type: 'text' })
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @Column({
    type: 'numeric',
    precision: 3,
    scale: 2,
    nullable: true,
    transformer: {
      to: (v: number | null) => v,
      from: (v: string | null) => (v == null ? null : Number(v)),
    },
  })
  confidence: number | null;

  @Column({
    name: 'last_used_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastUsedAt: Date;

  @Column({ name: 'use_count', type: 'int', default: 0 })
  useCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
