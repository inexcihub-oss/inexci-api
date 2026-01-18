import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';

@Entity('cid')
export class Cid {
  @Column({ type: 'varchar', length: 75, primary: true })
  id: string;

  @Column({ type: 'varchar', length: 75 })
  description: string;

  // Relations
  @OneToMany(() => SurgeryRequest, (request) => request.cid)
  surgery_requests: SurgeryRequest[];
}
