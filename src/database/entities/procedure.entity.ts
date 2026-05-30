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

/**
 * Tipo de procedimento cirúrgico (ex: "Artroscopia de Joelho").
 * Relacionado à solicitação cirúrgica como procedimento principal.
 * Não possui código TUSS — os itens TUSS ficam em SurgeryRequestTussItem.
 *
 * Catálogo por clínica/conta (ownerId): cada tenant possui seus próprios
 * procedimentos.
 */
@Entity('procedures')
@Index('idx_procedures_owner_id', ['ownerId'])
@Index('idx_procedures_deleted_at', ['deletedAt'])
export class Procedure {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** ID do admin dono da clínica (tenant isolation). */
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
}
