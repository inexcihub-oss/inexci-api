import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Role do membro da equipe
 * - MANAGER (0): Pode fazer tudo (criar, editar, deletar, gerenciar)
 * - EDITOR (1): Pode criar e editar, mas não deletar
 * - VIEWER (2): Apenas visualização
 */
export enum TeamMemberRole {
  MANAGER = 0,
  EDITOR = 1,
  VIEWER = 2,
}

/**
 * Status do membro da equipe
 */
export enum TeamMemberStatus {
  PENDING = 1, // Convite enviado, aguardando aceite
  ACTIVE = 2, // Ativo
  INACTIVE = 3, // Inativo/Removido
}

/**
 * Relacionamento entre Médico e Colaborador
 * Define quais colaboradores trabalham para quais médicos
 * e quais são suas permissões
 */
@Entity('team_member')
@Unique(['doctor_id', 'collaborator_id'])
export class TeamMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'doctor_id' })
  doctor_id: string;

  @Column({ name: 'collaborator_id' })
  collaborator_id: string;

  @Column({
    type: 'smallint',
    default: TeamMemberRole.EDITOR,
  })
  role: TeamMemberRole;

  @Column({
    type: 'smallint',
    default: TeamMemberStatus.PENDING,
  })
  status: TeamMemberStatus;

  // ============ PERMISSÕES GRANULARES ============

  @Column({ type: 'boolean', default: true })
  can_create_requests: boolean;

  @Column({ type: 'boolean', default: true })
  can_edit_requests: boolean;

  @Column({ type: 'boolean', default: false })
  can_delete_requests: boolean;

  @Column({ type: 'boolean', default: true })
  can_manage_documents: boolean;

  @Column({ type: 'boolean', default: true })
  can_manage_patients: boolean;

  @Column({ type: 'boolean', default: false })
  can_manage_billing: boolean;

  @Column({ type: 'boolean', default: false })
  can_manage_team: boolean;

  @Column({ type: 'boolean', default: true })
  can_view_reports: boolean;

  // ============ METADADOS ============

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'timestamp', nullable: true })
  invited_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  accepted_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  @ManyToOne(() => User, (user) => user.team_members)
  @JoinColumn({ name: 'doctor_id' })
  doctor: User;

  @ManyToOne(() => User, (user) => user.works_for)
  @JoinColumn({ name: 'collaborator_id' })
  collaborator: User;
}
