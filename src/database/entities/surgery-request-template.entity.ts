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

export interface SurgeryRequestTemplateData {
  procedure?: TemplateEntityRef;
  procedureName?: string;
  hospital?: TemplateEntityRef;
  healthPlan?: TemplateEntityRef;
  priority?: SurgeryRequestPriority;
  tussItems?: TemplateTussItem[];
  opmeItems?: TemplateOpmeItem[];
  requiredDocuments?: TemplateRequiredDocument[];
}

@Entity('surgery_request_templates')
@Index('idx_srt_doctor_id', ['doctorId'])
@Index('idx_srt_owner_id', ['ownerId'])
export class SurgeryRequestTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

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

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor: User;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;
}
