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
 */
@Entity('procedure')
export class Procedure {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
