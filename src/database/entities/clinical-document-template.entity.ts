import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export enum ClinicalDocumentTemplateKind {
  MEDICAL_CERTIFICATE = 'medical_certificate',
  EXAM_REFERRAL = 'exam_referral',
}

@Entity('clinical_document_templates')
@Index('idx_cdt_owner_id', ['ownerId'])
@Index('idx_cdt_doctor_kind', ['doctorId', 'kind'])
export class ClinicalDocumentTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  @Column({ type: 'varchar', length: 30 })
  kind: ClinicalDocumentTemplateKind;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'usage_count', type: 'int', default: 0 })
  usageCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_clinical_document_templates_owner',
  })
  owner: User;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'doctor_id',
    foreignKeyConstraintName: 'FK_clinical_document_templates_doctor',
  })
  doctor: User;
}
