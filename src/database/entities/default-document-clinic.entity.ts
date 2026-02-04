import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DoctorProfile } from './doctor-profile.entity';
import { User } from './user.entity';

/**
 * Documento padrão da clínica do médico
 * Templates de documentos que podem ser usados nas solicitações
 */
@Entity('default_document_clinic')
export class DefaultDocumentClinic {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'doctor_id' })
  doctor_id: string;

  @Column({ name: 'created_by' })
  created_by: string;

  @Column({ type: 'varchar', length: 50 })
  key: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  file_url: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @CreateDateColumn()
  created_at: Date;

  // ============ RELAÇÕES ============

  @ManyToOne(() => DoctorProfile, (doctor) => doctor.default_documents)
  @JoinColumn({ name: 'doctor_id' })
  doctor: DoctorProfile;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;
}
