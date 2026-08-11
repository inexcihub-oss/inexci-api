import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { SurgeryRequestPriority } from './surgery-request.entity';

export interface TemplateEntityRef {
  id: string;
  name: string;
}

export interface TemplateTussItem {
  tussCode: string;
  name: string;
  quantity: number;
}

export interface TemplateOpmeItem {
  name: string;
  quantity: number;
  manufacturers: string[];
  suppliers: string[];
}

export interface TemplateRequiredDocument {
  type: string;
  name: string;
}

/**
 * Estrutura do `template_data` (jsonb).
 *
 * O modelo é um *snapshot*, não uma referência à SC que o originou: ele
 * sobrevive à exclusão dela, é editável por conta própria e pode nascer do
 * zero, sem SC nenhuma. O que ele não pode ser é um despejo da SC — só entra
 * aqui o que o wizard reaproveita ao criar a próxima. `sanitizeTemplateData`
 * (no módulo de solicitações) é o único caminho de escrita que garante isso.
 */
export interface SurgeryRequestTemplateData {
  procedure?: TemplateEntityRef;
  /** Usado quando o modelo não aponta para um procedimento do catálogo. */
  procedureName?: string;
  hospital?: TemplateEntityRef;
  healthPlan?: TemplateEntityRef;
  priority?: SurgeryRequestPriority;
  tussItems?: TemplateTussItem[];
  opmeItems?: TemplateOpmeItem[];
  requiredDocuments?: TemplateRequiredDocument[];
}

/**
 * Template de solicitação cirúrgica.
 * Permite médicos salvarem modelos pré-configurados para criar solicitações rapidamente.
 *
 * Pertence a um médico (doctorId) e a uma clínica (ownerId).
 */
@Entity('surgery_request_templates')
@Index('idx_srt_doctor_id', ['doctorId'])
@Index('idx_srt_owner_id', ['ownerId'])
export class SurgeryRequestTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  /** ID do admin dono da clínica (denormalizado para tenant isolation). */
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'template_data', type: 'jsonb' })
  templateData: SurgeryRequestTemplateData;

  @Column({ name: 'usage_count', type: 'int', default: 0 })
  usageCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ============ RELAÇÕES ============

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor: User;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;
}
