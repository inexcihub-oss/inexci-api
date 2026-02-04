import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { DoctorProfile } from './doctor-profile.entity';
import { TeamMember } from './team-member.entity';
import { RecoveryCode } from './recovery-code.entity';
import { Chat } from './chat.entity';
import { ChatMessage } from './chat-message.entity';
import { Document } from './document.entity';
import { Notification } from './notification.entity';
import { UserNotificationSettings } from './user-notification-settings.entity';

/**
 * Roles de usuário no sistema
 * - ADMIN: Administrador da plataforma (acesso a todos os médicos)
 * - DOCTOR: Médico (dono da conta, gestor principal)
 * - COLLABORATOR: Colaborador/Assistente (trabalha para um ou mais médicos)
 */
export enum UserRole {
  ADMIN = 'admin',
  DOCTOR = 'doctor',
  COLLABORATOR = 'collaborator',
}

/**
 * Status do usuário
 */
export enum UserStatus {
  PENDING = 1, // Aguardando ativação
  ACTIVE = 2, // Ativo
  INACTIVE = 3, // Inativo/Suspenso
}

@Entity('user')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.DOCTOR,
  })
  role: UserRole;

  @Column({
    type: 'smallint',
    default: UserStatus.PENDING,
  })
  status: UserStatus;

  @Column({ type: 'varchar', length: 100, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  password: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  phone: string;

  @Column({ type: 'varchar', length: 14, nullable: true })
  cpf: string;

  @Column({ type: 'char', length: 1, nullable: true })
  gender: string;

  @Column({ type: 'date', nullable: true })
  birth_date: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  avatar_url: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  // Perfil de médico (1:1) - só existe se role = DOCTOR
  @OneToOne(() => DoctorProfile, (profile) => profile.user, { cascade: true })
  doctor_profile: DoctorProfile;

  // Colaboradores que este médico gerencia (quando role = DOCTOR)
  @OneToMany(() => TeamMember, (tm) => tm.doctor)
  team_members: TeamMember[];

  // Médicos para quem este colaborador trabalha (quando role = COLLABORATOR)
  @OneToMany(() => TeamMember, (tm) => tm.collaborator)
  works_for: TeamMember[];

  // Códigos de recuperação de senha
  @OneToMany(() => RecoveryCode, (code) => code.user)
  recovery_codes: RecoveryCode[];

  // Chats do usuário
  @OneToMany(() => Chat, (chat) => chat.user)
  chats: Chat[];

  // Mensagens enviadas
  @OneToMany(() => ChatMessage, (message) => message.sender)
  sent_messages: ChatMessage[];

  // Documentos inseridos
  @OneToMany(() => Document, (document) => document.creator)
  inserted_documents: Document[];

  // Notificações
  @OneToMany(() => Notification, (notification) => notification.user)
  notifications: Notification[];

  // Configurações de notificação
  @OneToOne(() => UserNotificationSettings, (settings) => settings.user)
  notification_settings: UserNotificationSettings;
}
