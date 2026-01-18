import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';
import { Procedure } from './procedure.entity';

@Entity('surgery_request_procedure')
export class SurgeryRequestProcedure {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: number;

  @Column({ name: 'procedure_id' })
  procedure_id: number;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'int', nullable: true })
  authorized_quantity: number;

  // Relations
  @ManyToOne(() => SurgeryRequest, (request) => request.procedures)
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;

  @ManyToOne(() => Procedure, (procedure) => procedure.surgery_requests)
  @JoinColumn({ name: 'procedure_id' })
  procedure: Procedure;
}
