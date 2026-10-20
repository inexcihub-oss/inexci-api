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

export function isPhysicianProfile(
  profile: { council?: string | null } | null | undefined,
): boolean {
  return !!profile && profile.council === ProfessionalCouncil.CRM;
}

const CONSELHOS_QUE_EMITEM_DOCUMENTOS: ReadonlySet<string> = new Set([
  ProfessionalCouncil.CRM,
  ProfessionalCouncil.CRO,
]);

export function isClinicalDocumentIssuerProfile(
  profile: { council?: string | null } | null | undefined,
): boolean {
  return (
    !!profile?.council && CONSELHOS_QUE_EMITEM_DOCUMENTOS.has(profile.council)
  );
}

export function hasCouncilRegistry(
  profile: { crm?: string | null; crmState?: string | null } | null | undefined,
): boolean {
  return !!profile?.crm?.trim() && !!profile?.crmState?.trim();
}

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

  @Column({ type: 'varchar', length: 20, nullable: true })
  crm: string | null;

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

  @OneToOne(() => User, (user) => user.doctorProfile)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToOne(() => DoctorHeader, (h) => h.doctorProfile, {
    cascade: true,
    eager: false,
  })
  header: DoctorHeader | null;
}
