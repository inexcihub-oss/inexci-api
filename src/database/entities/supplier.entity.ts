import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  ManyToMany,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { SurgeryRequestQuotation } from './surgery-request-quotation.entity';
import { OpmeItem } from './opme-item.entity';

/**
 * Fornecedor de OPME — Entidade de negócio (não faz login).
 * Cadastro pertence à clínica/conta (ownerId): médicos e colaboradores
 * da mesma clínica compartilham os fornecedores cadastrados.
 */
@Entity('suppliers')
@Index('idx_suppliers_owner_id', ['ownerId'])
export class Supplier {
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

  // ============ CONTATO COMERCIAL ============

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

  // ============ COMERCIAL ============

  @Column({ type: 'varchar', length: 200, nullable: true })
  website: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  category: string | null;

  @Column({
    name: 'payment_terms',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  paymentTerms: string | null;

  @Column({
    name: 'delivery_time',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  deliveryTime: string | null;

  // ============ OBSERVAÇÕES ============

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // ============ STATUS ============

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // ============ ISOLAMENTO POR CLÍNICA ============

  /** ID do admin dono da clínica. */
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

  @OneToMany(() => SurgeryRequestQuotation, (quotation) => quotation.supplier)
  quotations: SurgeryRequestQuotation[];

  @ManyToMany(() => OpmeItem, (opmeItem) => opmeItem.suppliers)
  opmeItems: OpmeItem[];
}
