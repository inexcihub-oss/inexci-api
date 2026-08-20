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
import { BusinessHours } from 'src/shared/business-hours/business-hours.types';

/**
 * Clinic — local de atendimento da conta. Um médico pode atender em mais de
 * uma unidade; a consulta aponta para a unidade onde acontece.
 *
 * Atenção ao duplo sentido de "clínica" no código: `ownerId` continua sendo o
 * dono da **conta** (tenant). Esta entidade é o **endereço físico**.
 */
@Entity('clinics')
@Index('idx_clinics_owner_id', ['ownerId'])
export class Clinic {
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

  // ============ FUNCIONAMENTO ============

  /**
   * Grade semanal (`{ mon: [{ start, end }], ... }`). Guardada como `jsonb`
   * porque é sempre lida e gravada inteira e nunca filtrada em SQL — tabela
   * normalizada custaria um join em toda leitura sem entregar constraint
   * nenhuma ("sem sobreposição" não é expressável em CHECK).
   */
  @Column({ name: 'business_hours', type: 'jsonb', default: () => "'{}'" })
  businessHours: BusinessHours;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // ============ ISOLAMENTO POR CONTA ============

  /** ID do admin dono da conta — todos os usuários da conta enxergam a mesma clínica. */
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
}
