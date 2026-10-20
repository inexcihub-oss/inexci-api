import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ClinicalAccessOrigin = 'http' | 'ai' | 'system';

@Entity('clinical_access_audit')
@Index('idx_clinical_access_audit_owner_created', ['ownerId', 'createdAt'])
@Index('idx_clinical_access_audit_patient_created', ['patientId', 'createdAt'])
@Index('idx_clinical_access_audit_created_at', ['createdAt'])
export class ClinicalAccessAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({ type: 'varchar', length: 32 })
  action: string;

  @Column({ type: 'varchar', length: 32 })
  resource: string;

  @Column({ name: 'resource_id', type: 'varchar', length: 64, nullable: true })
  resourceId: string | null;

  @Column({ name: 'patient_id', type: 'uuid', nullable: true })
  patientId: string | null;

  @Column({ type: 'varchar', length: 16 })
  origin: ClinicalAccessOrigin;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 128, nullable: true })
  requestId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
