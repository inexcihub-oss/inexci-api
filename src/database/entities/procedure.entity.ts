import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Tipo de procedimento cirúrgico (ex: "Artroscopia de Joelho").
 * Relacionado à solicitação cirúrgica como procedimento principal.
 * Não possui código TUSS — os itens TUSS ficam em SurgeryRequestTussItem.
 *
 * É um catálogo global compartilhado por todas as clínicas.
 */
@Entity('procedures')
export class Procedure {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
