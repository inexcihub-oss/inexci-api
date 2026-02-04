import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';

/**
 * Hospital - Entidade de negócio (não faz login)
 * Cadastro global compartilhado entre médicos
 */
@Entity('hospital')
export class Hospital {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  cnpj: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  phone: string;

  // ============ CONTATO ============

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

  // ============ STATUS ============

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // ============ CONTROLE DE PROPRIEDADE ============

  @Column({ name: 'doctor_id' })
  doctor_id: string; // Hospital pertence a este médico

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  @OneToMany(() => SurgeryRequest, (request) => request.hospital)
  surgery_requests: SurgeryRequest[];
}
