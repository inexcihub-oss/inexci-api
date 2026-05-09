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
 * Tipos de contestação armazenados como enum no banco
 */
export enum ContestationTypeEnum {
  AUTHORIZATION = 'authorization',
  PAYMENT = 'payment',
}

/**
 * Contestação — registrada quando o usuário contesta uma autorização parcial/recusada
 * ou quando há divergência no valor recebido de pagamento.
 */
@Entity('contestations')
export class Contestation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id', type: 'uuid' })
  surgeryRequestId: string;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  @Column({
    type: 'enum',
    enum: ContestationTypeEnum,
  })
  type: ContestationTypeEnum;

  @Column({ type: 'text' })
  reason: string;

  /** null = contestação ainda ativa */
  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ============ RELAÇÕES ============

  @ManyToOne(() => SurgeryRequest, (request) => request.contestations)
  @JoinColumn({ name: 'surgery_request_id' })
  surgeryRequest: SurgeryRequest;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;

  @OneToMany(() => Document, (doc) => doc.contestation)
  documents: Document[];
}
