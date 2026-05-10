import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';

/**
 * Dados da fase de análise pela operadora de saúde (relação 1:1 com SurgeryRequest).
 * Armazena número de protocolo, cotações e quando a operadora recebeu a solicitação.
 */
@Entity('surgery_request_analyses')
export class SurgeryRequestAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id', type: 'uuid' })
  surgeryRequestId: string;

  /** Número do protocolo gerado pela operadora */
  @Column({ name: 'request_number', type: 'varchar', length: 100 })
  requestNumber: string;

  /** Quando a operadora recebeu a solicitação */
  @Column({ name: 'received_at', type: 'timestamp' })
  receivedAt: Date;

  // ── Cotação 1 ──────────────────────────────────
  @Column({
    name: 'quotation_1_number',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  quotation1Number: string | null;

  @Column({
    name: 'quotation_1_received_at',
    type: 'timestamp',
    nullable: true,
  })
  quotation1ReceivedAt: Date | null;

  // ── Cotação 2 ──────────────────────────────────
  @Column({
    name: 'quotation_2_number',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  quotation2Number: string | null;

  @Column({
    name: 'quotation_2_received_at',
    type: 'timestamp',
    nullable: true,
  })
  quotation2ReceivedAt: Date | null;

  // ── Cotação 3 ──────────────────────────────────
  @Column({
    name: 'quotation_3_number',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  quotation3Number: string | null;

  @Column({
    name: 'quotation_3_received_at',
    type: 'timestamp',
    nullable: true,
  })
  quotation3ReceivedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ============ RELAÇÕES ============

  @OneToOne(() => SurgeryRequest, (request) => request.analysis)
  @JoinColumn({ name: 'surgery_request_id' })
  surgeryRequest: SurgeryRequest;
}
