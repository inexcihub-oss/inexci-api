import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { DoctorProfile } from './doctor-profile.entity';
import { UserDoctorAccess } from './user-doctor-access.entity';
import { RecoveryCode } from './recovery-code.entity';
import { Chat } from './chat.entity';
import { ChatMessage } from './chat-message.entity';
import { Document } from './document.entity';
import { Notification } from './notification.entity';
import { UserNotificationSettings } from './user-notification-settings.entity';
import { SubscriptionPlan } from './subscription-plan.entity';

/**
 * Roles de usuário no sistema
 * - ADMIN: Administrador da conta (gerencia usuários e plano)
 * - COLLABORATOR: Colaborador criado por um admin
 *
 * "Médico" não é um role — é definido pela existência de um doctor_profile.
 */
export enum UserRole {
  ADMIN = 'admin',
  COLLABORATOR = 'collaborator',
}

/**
 * Status do usuário
 */
export enum UserStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('user')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.COLLABORATOR,
  })
  role: UserRole;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.PENDING,
  })
  status: UserStatus;

  @Column({ type: 'varchar', length: 100, unique: true })
  email: string;

  @Exclude()
  @Column({ type: 'varchar', length: 60, nullable: true, select: false })
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

  @Column({ name: 'account_id' })
  account_id: string;

  @Column({ name: 'subscription_plan_id', nullable: true })
  subscription_plan_id: string;

  @Column({ name: 'admin_id', nullable: true })
  admin_id: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ============ RELAÇÕES ============

  // Conta raiz (particionamento por tenant) — self-referencing
  // nullable: true é necessário no TypeORM para evitar CircularRelationsError
  // na prática o DB garante NOT NULL via migration
  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: User;

  // Plano de assinatura (apenas para Admins)
  @ManyToOne(() => SubscriptionPlan, (plan) => plan.users, { nullable: true })
  @JoinColumn({ name: 'subscription_plan_id' })
  subscription_plan: SubscriptionPlan;

  // Admin que criou este usuário (self-referencing, para colaboradores)
  @ManyToOne(() => User, (user) => user.managed_users, { nullable: true })
  @JoinColumn({ name: 'admin_id' })
  admin: User;

  // Usuários gerenciados por este Admin
  @OneToMany(() => User, (user) => user.admin)
  managed_users: User[];

  // Perfil de médico (1:1) — existe se o usuário é médico
  @OneToOne(() => DoctorProfile, (profile) => profile.user, { cascade: true })
  doctor_profile: DoctorProfile;

  // Médicos que este usuário acessa (vínculos ativos em user_doctor_access)
  @OneToMany(() => UserDoctorAccess, (uda) => uda.user)
  doctor_accesses: UserDoctorAccess[];

  // Quem acessa este usuário como médico (inverso do vínculo)
  @OneToMany(() => UserDoctorAccess, (uda) => uda.doctor)
  accessible_by: UserDoctorAccess[];

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

  // ============ PROPRIEDADE VIRTUAL ============

  /**
   * Indica se o usuário é médico.
   * Baseado na existência de doctor_profile (precisa ser carregado via relation).
   * Usado apenas para serialização no response, NÃO para lógica interna.
   */
  get is_doctor(): boolean {
    return !!this.doctor_profile;
  }
}
