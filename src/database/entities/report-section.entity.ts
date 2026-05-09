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
 * Representa uma seção dinâmica de laudo médico.
 * Substitui os campos fixos `conduta` e `historicoEDiagnostico`.
 */
@Entity('reportSections')
export class ReportSection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  /** Conteúdo em HTML gerado pelo editor rich text. */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Posição da seção dentro do laudo (ordenação). */
  @Column({ type: 'int', default: 0 })
  order: number;

  @Column({ name: 'surgery_request_id', type: 'uuid' })
  surgeryRequestId: string;

  @ManyToOne(() => SurgeryRequest, (sr) => sr.reportSections, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'surgery_request_id' })
  surgeryRequest: SurgeryRequest;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
