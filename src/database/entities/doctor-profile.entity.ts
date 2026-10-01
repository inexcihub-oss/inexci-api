import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { DoctorHeader } from './doctor-header.entity';

/**
 * Conselho profissional. Gravado como texto em `doctor_profiles.council`.
 *
 * Só `CRM` é médico: emite receita, atestado e pedido de exame, indica cirurgia
 * e enxerga Solicitações. Os demais (psicologia, nutrição, enfermagem…) têm
 * agenda e prontuário próprios.
 */
export enum ProfessionalCouncil {
  CRM = 'CRM',
  CRP = 'CRP',
  CRN = 'CRN',
  COREN = 'COREN',
  CREFITO = 'CREFITO',
  CRFA = 'CRFA',
  CRO = 'CRO',
  CRBM = 'CRBM',
  CREF = 'CREF',
  OUTRO = 'OUTRO',
}

/**
 * Médico de fato: perfil com conselho CRM. Estrito de propósito — um perfil
 * carregado sem a coluna `council` (select parcial) **não** vira médico por
 * omissão, para não abrir Solicitações e receita a quem não é.
 */
export function isPhysicianProfile(
  profile: { council?: string | null } | null | undefined,
): boolean {
  return !!profile && profile.council === ProfessionalCouncil.CRM;
}

/**
 * Perfil profissional de saúde (nome histórico: "doctor profile").
 * Um usuário (admin ou collaborator) atende pacientes se e somente se existir
 * um registro nesta tabela com seu userId. Se é **médico** depende do
 * `council` — ver `isPhysicianProfile`.
 */
@Entity('doctor_profiles')
export class DoctorProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @Column({
    type: 'varchar',
    length: 10,
    default: ProfessionalCouncil.CRM,
  })
  council: ProfessionalCouncil;

  /**
   * Número no conselho (nome histórico `crm`). Obrigatório para CRM — regra no
   * DTO/service, não no banco; opcional para os demais conselhos.
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  crm: string | null;

  /** UF do conselho (nome histórico `crm_state`). */
  @Column({ name: 'crm_state', type: 'char', length: 2, nullable: true })
  crmState: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  specialty: string | null;

  @Column({
    name: 'signature_url',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  signatureUrl: string | null;

  @Column({ name: 'clinic_name', type: 'varchar', length: 150, nullable: true })
  clinicName: string | null;

  @Column({ name: 'clinic_cnpj', type: 'varchar', length: 20, nullable: true })
  clinicCnpj: string | null;

  @Column({
    name: 'clinic_address',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  clinicAddress: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ============ RELAÇÕES ============

  @OneToOne(() => User, (user) => user.doctorProfile)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToOne(() => DoctorHeader, (h) => h.doctorProfile, {
    cascade: true,
    eager: false,
  })
  header: DoctorHeader | null;
}
