import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { SurgeryRequestProcedure } from './surgery-request-procedure.entity';

@Entity('procedure')
export class Procedure {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'boolean' })
  active: boolean;

  @Column({ type: 'varchar', length: 100 })
  tuss_code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Relations
  @OneToMany(() => SurgeryRequestProcedure, (srp) => srp.procedure)
  surgery_requests: SurgeryRequestProcedure[];
}
