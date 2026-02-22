import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Template de solicitação cirúrgica.
 * Permite médicos salvarem modelos pré-configurados para criar solicitações rapidamente.
 *
 * Estrutura do template_data:
 * {
 *   procedure_id?: string;
 *   opme_items?: Array<{ name: string; brand: string; distributor: string; quantity: number }>;
 *   required_documents?: string[];  // tipos de documento
 *   required_exams?: string[];      // texto livre
 * }
 */
@Entity('surgery_request_template')
export class SurgeryRequestTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'doctor_id' })
  doctor_id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'jsonb' })
  template_data: {
    procedure_id?: string;
    opme_items?: Array<{
      name: string;
      brand: string;
      distributor: string;
      quantity: number;
    }>;
    required_documents?: string[];
    required_exams?: string[];
  };

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'doctor_id' })
  doctor: User;
}
