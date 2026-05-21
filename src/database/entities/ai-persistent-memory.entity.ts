import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type AiPersistentMemoryScope =
  | 'preference'
  | 'entity'
  | 'pattern'
  | 'goal';

@Entity('ai_persistent_memories')
@Index('idx_ai_persistent_memory_user_scope_key', ['userId', 'scope', 'key'], {
  unique: true,
})
@Index('idx_ai_persistent_memory_user_scope', ['userId', 'scope'])
export class AiPersistentMemory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 32 })
  scope: AiPersistentMemoryScope;

  @Column({ type: 'varchar', length: 120 })
  key: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  value: Record<string, unknown>;

  @Column({ type: 'numeric', precision: 5, scale: 4, default: 0.5 })
  confidence: number;

  @Column({ name: 'last_accessed_at', type: 'timestamptz', nullable: true })
  lastAccessedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
