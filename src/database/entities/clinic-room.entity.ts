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
import { Clinic } from './clinic.entity';

/**
 * Sala (consultório) dentro de uma clínica. Opcional: consulta sem sala
 * continua válida, e clínica sem sala nenhuma funciona como antes.
 */
@Entity('clinic_rooms')
@Index('idx_clinic_rooms_clinic_id', ['clinicId'])
export class ClinicRoom {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Dono da conta — mesmo isolamento de `Clinic`. */
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'clinic_id', type: 'uuid' })
  clinicId: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @ManyToOne(() => Clinic, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clinic_id' })
  clinic: Clinic;
}
