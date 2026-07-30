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
import { ClinicalCidCode } from './clinical-record.entity';

/**
 * Modelo de anamnese: o esqueleto que o médico reaproveita a cada atendimento
 * (queixa, exame físico, hipótese e conduta já pré-escritos).
 *
 * Guarda os mesmos campos da `ClinicalRecord` porque aplicar um modelo é
 * exatamente preencher a ficha com eles. Pertence à clínica (`owner_id`) e ao
 * médico (`doctor_id`) — o mesmo par que escopa fichas e consultas.
 */
@Entity('clinical_record_templates')
@Index('idx_crt_owner_id', ['ownerId'])
@Index('idx_crt_doctor_id', ['doctorId'])
export class ClinicalRecordTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Rótulo livre (ex.: `Ortopedia`) para agrupar os modelos na lista. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  specialty: string | null;

  @Column({ type: 'text', nullable: true })
  anamnesis: string | null;

  @Column({ name: 'physical_exam', type: 'text', nullable: true })
  physicalExam: string | null;

  @Column({ type: 'text', nullable: true })
  diagnosis: string | null;

  @Column({ type: 'text', nullable: true })
  conduct: string | null;

  @Column({ name: 'cid_codes', type: 'jsonb', nullable: true })
  cidCodes: ClinicalCidCode[] | null;

  /** Quantas vezes o modelo já foi aplicado — ordena a lista pelo mais usado. */
  @Column({ name: 'usage_count', type: 'int', default: 0 })
  usageCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  // ============ RELAÇÕES ============

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor: User;
}
