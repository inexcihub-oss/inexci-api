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

/**
 * Estrutura do templateData armazenado em jsonb.
 */
export interface SurgeryRequestTemplateData {
  procedureId?: string;
  opmeItems?: Array<{
    name: string;
    brand: string;
    distributor: string;
    quantity: number;
  }>;
  requiredDocuments?: string[];
  required_exams?: string[];
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
