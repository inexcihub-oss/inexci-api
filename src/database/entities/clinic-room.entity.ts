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

export const CLINIC_ROOM_NOME_UNICO = 'uq_clinic_rooms_clinic_name_active';

@Entity('clinic_rooms')
@Index('idx_clinic_rooms_clinic_id', ['clinicId'])
@Index(CLINIC_ROOM_NOME_UNICO, { synchronize: false })
export class ClinicRoom {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_clinic_rooms_owner',
  })
  owner: User;

  @ManyToOne(() => Clinic, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'clinic_id',
    foreignKeyConstraintName: 'FK_clinic_rooms_clinic',
  })
  clinic: Clinic;
}
