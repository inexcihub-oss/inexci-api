import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('ai_knowledge_chunk')
@Index('idx_knowledge_category_active', ['category', 'active'])
export class AiKnowledgeChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  category: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  // Coluna vector(1536) é criada/gerenciada via migration (RAG bootstrap valida pgvector).
  // Mantida como text + select: false para evitar carga acidental nos finds genéricos;
  // escrita real é feita via dataSource.query raw (cast ::vector).
  @Column({ type: 'text', nullable: true, select: false })
  embedding: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
