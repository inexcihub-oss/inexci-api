import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';
import { User } from './user.entity';
import { Document } from './document.entity';

/**
 * Tipos de contestação
 */
export type ContestationType = 'authorization' | 'payment';

/**
 * Contestação — registrada quando o usuário contesta uma autorização parcial/recusada
 * ou quando há divergência no valor recebido de pagamento.
 */
@Entity('contestation')
export class Contestation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: string;

  @Column({ name: 'created_by_id' })
  created_by_id: string;

  /** 'authorization' | 'payment' */
  @Column({ type: 'varchar', length: 50 })
  type: ContestationType;

  @Column({ type: 'text' })
  reason: string;

  /** null = contestação ainda ativa */
  @Column({ type: 'timestamp', nullable: true })
  resolved_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  @ManyToOne(() => SurgeryRequest, (request) => request.contestations)
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'created_by_id' })
  created_by: User;

  @OneToMany(() => Document, (doc) => doc.contestation)
  documents: Document[];
}
