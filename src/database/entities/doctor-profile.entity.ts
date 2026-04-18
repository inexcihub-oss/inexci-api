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

/**
 * Perfil profissional do médico.
 * Um usuário (admin ou collaborator) é médico se e somente se
 * existir um registro nesta tabela com seu user_id.
 */
@Entity('doctor_profile')
export class DoctorProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', unique: true })
  user_id: string;

  @Column({ type: 'varchar', length: 20 })
  crm: string;

  @Column({ type: 'char', length: 2 })
  crm_state: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  specialty: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  signature_url: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  clinic_name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  clinic_cnpj: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  clinic_address: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  @OneToOne(() => User, (user) => user.doctor_profile)
  @JoinColumn({ name: 'user_id' })
  user: User;
}
