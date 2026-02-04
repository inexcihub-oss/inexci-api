import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Patient } from './patient.entity';
import { SurgeryRequest } from './surgery-request.entity';

/**
 * Plano de Saúde/Convênio - Entidade de negócio (não faz login)
 * Cadastro global compartilhado entre médicos
 */
@Entity('health_plan')
export class HealthPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  ans_code: string; // Código ANS

  @Column({ type: 'varchar', length: 20, nullable: true })
  cnpj: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  phone: string;

  // ============ CONTATO PARA AUTORIZAÇÕES ============

  @Column({ type: 'varchar', length: 100, nullable: true })
  authorization_contact: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  authorization_phone: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  authorization_email: string;

  // ============ WEBSITE/PORTAL ============

  @Column({ type: 'varchar', length: 255, nullable: true })
  website: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  portal_url: string; // URL do portal de autorizações

  // ============ OBSERVAÇÕES ============

  @Column({ type: 'text', nullable: true })
  notes: string;

  // ============ STATUS ============

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // ============ CONTROLE DE PROPRIEDADE ============

  @Column({ name: 'doctor_id' })
  doctor_id: string; // Plano pertence a este médico

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  @OneToMany(() => Patient, (patient) => patient.health_plan)
  patients: Patient[];

  @OneToMany(() => SurgeryRequest, (request) => request.health_plan)
  surgery_requests: SurgeryRequest[];
}
