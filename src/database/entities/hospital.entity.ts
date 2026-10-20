import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { SurgeryRequest } from './surgery-request.entity';

export const HOSPITAL_NOME_UNICO = 'uq_hospitals_owner_name_active';

@Entity('hospitals')
@Index('idx_hospitals_owner_id', ['ownerId'])
@Index(HOSPITAL_NOME_UNICO, { synchronize: false })
export class Hospital {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  cnpj: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  phone: string | null;

  @Column({
    name: 'contact_name',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  contactName: string | null;

  @Column({
    name: 'contact_phone',
    type: 'varchar',
    length: 15,
    nullable: true,
  })
  contactPhone: string | null;

  @Column({
    name: 'contact_email',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  contactEmail: string | null;

  @Column({ name: 'zip_code', type: 'varchar', length: 10, nullable: true })
  zipCode: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  address: string | null;

  @Column({
    name: 'address_number',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  addressNumber: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  neighborhood: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'char', length: 2, nullable: true })
  state: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @OneToMany(() => SurgeryRequest, (request) => request.hospital)
  surgeryRequests: SurgeryRequest[];
}
