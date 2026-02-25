import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';

/**
 * Itens TUSS vinculados a uma solicitação cirúrgica.
 * Uma solicitação pode ter múltiplos itens TUSS.
 * Esta entidade é separada de `Procedure`, que representa o tipo de procedimento cirúrgico.
 */
@Entity('surgery_request_tuss_item')
export class SurgeryRequestTussItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: string;

  @Column({ type: 'varchar', length: 50 })
  tuss_code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ type: 'int', nullable: true })
  authorized_quantity: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Relations
  @ManyToOne(() => SurgeryRequest, (sr) => sr.tuss_items)
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;
}
