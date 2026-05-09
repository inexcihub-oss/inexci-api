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

/**
 * Hospital — Entidade de negócio (não faz login).
 * Cadastro pertence à clínica/conta (ownerId): médicos e colaboradores
 * da mesma clínica compartilham os hospitais cadastrados.
 */
@Entity('hospitals')
@Index('idx_hospitals_owner_id', ['ownerId'])
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

  // ============ CONTATO ============

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

  // ============ ENDEREÇO ============

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

  // ============ STATUS ============

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // ============ ISOLAMENTO POR CLÍNICA ============

  /** ID do admin dono da clínica — todos os usuários da mesma clínica enxergam o mesmo hospital. */
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  // ============ RELAÇÕES ============

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @OneToMany(() => SurgeryRequest, (request) => request.hospital)
  surgeryRequests: SurgeryRequest[];
}
