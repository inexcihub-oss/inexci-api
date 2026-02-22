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
@Entity('surgery_request_analysis')
export class SurgeryRequestAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: string;

  /** Número do protocolo gerado pela operadora */
  @Column({ type: 'varchar', length: 100 })
  request_number: string;

  /** Quando a operadora recebeu a solicitação */
  @Column({ type: 'timestamp' })
  received_at: Date;

  // ── Cotação 1 ──────────────────────────────────
  @Column({ type: 'varchar', length: 100, nullable: true })
  quotation_1_number: string;

  @Column({ type: 'timestamp', nullable: true })
  quotation_1_received_at: Date;

  // ── Cotação 2 ──────────────────────────────────
  @Column({ type: 'varchar', length: 100, nullable: true })
  quotation_2_number: string;

  @Column({ type: 'timestamp', nullable: true })
  quotation_2_received_at: Date;

  // ── Cotação 3 ──────────────────────────────────
  @Column({ type: 'varchar', length: 100, nullable: true })
  quotation_3_number: string;

  @Column({ type: 'timestamp', nullable: true })
  quotation_3_received_at: Date;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  @OneToOne(() => SurgeryRequest, (request) => request.analysis)
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;
}
