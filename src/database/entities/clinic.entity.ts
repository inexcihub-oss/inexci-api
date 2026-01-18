import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { User } from './user.entity';
import { DefaultDocumentClinic } from './default-document-clinic.entity';

@Entity('clinic')
export class Clinic {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 75 })
  name: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Relations
  @OneToMany(() => User, (user) => user.clinic)
  users: User[];

  @OneToMany(() => DefaultDocumentClinic, (document) => document.clinic)
  default_document_clinic: DefaultDocumentClinic[];
}
