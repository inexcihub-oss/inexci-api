import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { DoctorHeader } from './doctor-header.entity';

/**
 * Perfil profissional do médico.
 * Um usuário (admin ou collaborator) é médico se e somente se
 * existir um registro nesta tabela com seu userId.
 */
@Entity('doctor_profiles')
export class DoctorProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @Column({ type: 'varchar', length: 20 })
  crm: string;

  @Column({ name: 'crm_state', type: 'char', length: 2 })
  crmState: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  specialty: string | null;

  @Column({
    name: 'signature_url',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  signatureUrl: string | null;

  @Column({ name: 'clinic_name', type: 'varchar', length: 150, nullable: true })
  clinicName: string | null;

  @Column({ name: 'clinic_cnpj', type: 'varchar', length: 20, nullable: true })
  clinicCnpj: string | null;

  @Column({
    name: 'clinic_address',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  clinicAddress: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ============ RELAÇÕES ============

  @OneToOne(() => User, (user) => user.doctorProfile)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToOne(() => DoctorHeader, (h) => h.doctorProfile, {
    cascade: true,
    eager: false,
  })
  header: DoctorHeader | null;
}
