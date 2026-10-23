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
import { encryptedTransformer } from '../../shared/crypto/encryption.util';
import { User } from './user.entity';

export const SNIPPET_ATALHO_UNICO =
  'uq_clinical_snippets_doctor_shortcut_active';

@Entity('clinical_snippets')
@Index('idx_clinical_snippets_owner_id', ['ownerId'])
@Index('idx_clinical_snippets_doctor_id', ['doctorId'])
@Index(SNIPPET_ATALHO_UNICO, { synchronize: false })
export class ClinicalSnippet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  @Column({ type: 'varchar', length: 40 })
  shortcut: string;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'text', transformer: encryptedTransformer })
  content: string;

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
    foreignKeyConstraintName: 'FK_clinical_snippets_owner',
  })
  owner: User;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'doctor_id',
    foreignKeyConstraintName: 'FK_clinical_snippets_doctor',
  })
  doctor: User;
}
