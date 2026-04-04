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
@Entity('report_section')
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

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: string;

  @ManyToOne(() => SurgeryRequest, (sr) => sr.report_sections, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
}
