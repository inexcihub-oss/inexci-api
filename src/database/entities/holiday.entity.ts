import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Feriado da conta (MIG-05). `recurring` repete todo ano no mesmo dia/mês;
 * `blocksAgenda` impede agendar no dia (senão é só informativo).
 */
@Entity('holidays')
@Index('idx_holidays_owner_date', ['ownerId', 'date'])
export class Holiday {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** `YYYY-MM-DD`. */
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'boolean', default: false })
  recurring: boolean;

  @Column({ name: 'blocks_agenda', type: 'boolean', default: true })
  blocksAgenda: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;

  // Nome explícito: o que as migrations criaram (1755800700000 + renomeação
  // em 1755800800000), para o `migration:generate` não recriar a FK.
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_holidays_owner',
  })
  owner: User;
}
