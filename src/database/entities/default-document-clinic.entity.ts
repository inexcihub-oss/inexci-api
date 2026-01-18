import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Clinic } from './clinic.entity';
import { User } from './user.entity';

@Entity('default_document_clinic')
export class DefaultDocumentClinic {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'clinic_id' })
  clinic_id: number;

  @Column({ name: 'created_by' })
  created_by: number;

  @Column({ type: 'varchar', length: 50 })
  key: string;

  @Column({ type: 'varchar', length: 75 })
  name: string;

  @CreateDateColumn()
  created_at: Date;

  // Relations
  @ManyToOne(() => Clinic, (clinic) => clinic.default_document_clinic)
  @JoinColumn({ name: 'clinic_id' })
  clinic: Clinic;

  @ManyToOne(() => User, (user) => user.default_document_clinic)
  @JoinColumn({ name: 'created_by' })
  creator: User;
}
