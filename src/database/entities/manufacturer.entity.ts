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
  ManyToMany,
} from 'typeorm';
import { User } from './user.entity';
import { OpmeItem } from './opme-item.entity';

/**
 * Fabricante de OPME — Entidade de negócio (não faz login).
 * Cadastro pertence à clínica/conta (ownerId): médicos e colaboradores
 * da mesma clínica compartilham os fabricantes cadastrados.
 */
@Entity('manufacturers')
@Index('idx_manufacturers_owner_id', ['ownerId'])
export class Manufacturer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  cnpj: string | null;

  @Column({
    name: 'anvisa_registration',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  anvisaRegistration: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  website: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  country: string | null;

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

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  /**
   * Marca o fabricante genérico "Outro" da conta — o que significa "nenhum dos
   * cadastrados". Uma linha por conta, escondida do catálogo e criada sob
   * demanda. É flag e não nome para que relatório possa contá-lo ou excluí-lo
   * sem comparar texto.
   */
  @Column({ name: 'is_generic', type: 'boolean', default: false })
  isGeneric: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @ManyToMany(() => OpmeItem, (opmeItem) => opmeItem.manufacturers)
  opmeItems: OpmeItem[];
}
