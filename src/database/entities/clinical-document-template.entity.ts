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

/** Documento que o modelo preenche. */
export enum ClinicalDocumentTemplateKind {
  MEDICAL_CERTIFICATE = 'medical_certificate',
  EXAM_REFERRAL = 'exam_referral',
}

/**
 * Modelo de texto de documento clínico (MIG-06): o texto-base do atestado
 * (observações) ou do pedido de exame (indicação clínica), com placeholders
 * como `{{paciente.nome}}` resolvidos na hora de emitir.
 *
 * O corpo é **texto puro** com quebras de linha, porque é isso que os campos
 * do PDF imprimem (`white-space: pre-line`, escapado pelo Handlebars) — HTML
 * sairia com as tags à mostra. Mesmo escopo dos modelos de anamnese: clínica
 * (`owner_id`) + médico (`doctor_id`).
 */
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

  /** Quantas vezes o modelo já foi aplicado — ordena a lista pelo mais usado. */
  @Column({ name: 'usage_count', type: 'int', default: 0 })
  usageCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  // ============ RELAÇÕES ============
  // Nomes de constraint explícitos: são os que as migrations criaram
  // (1755800600000 + renomeação em 1755800800000). Sem eles o TypeORM gera um
  // nome por hash e o `migration:generate` sai derrubando e recriando as FKs.

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
