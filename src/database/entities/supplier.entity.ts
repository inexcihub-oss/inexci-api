import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { SurgeryRequestQuotation } from './surgery-request-quotation.entity';

/**
 * Fornecedor de OPME - Entidade de negócio (não faz login)
 * Cadastro global compartilhado entre médicos
 */
@Entity('supplier')
export class Supplier {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  cnpj: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  phone: string;

  // ============ CONTATO COMERCIAL ============

  @Column({ type: 'varchar', length: 100, nullable: true })
  contact_name: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  contact_phone: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  contact_email: string;

  // ============ ENDEREÇO ============

  @Column({ type: 'varchar', length: 10, nullable: true })
  zip_code: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  address: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  address_number: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  neighborhood: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string;

  @Column({ type: 'char', length: 2, nullable: true })
  state: string;

  // ============ OBSERVAÇÕES ============

  @Column({ type: 'text', nullable: true })
  notes: string;

  // ============ STATUS ============

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // ============ CONTROLE DE PROPRIEDADE ============

  @Column({ type: 'boolean', default: true })
  is_global: boolean; // Fornecedor global ou específico do médico

  @Column({ name: 'doctor_id', nullable: true })
  doctor_id: number; // Se is_global=false, pertence a este médico

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  @OneToMany(() => SurgeryRequestQuotation, (quotation) => quotation.supplier)
  quotations: SurgeryRequestQuotation[];
}
