import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToOne,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { DoctorProfile } from './doctor-profile.entity';
import { UserDoctorAccess } from './user-doctor-access.entity';
import { RecoveryCode } from './recovery-code.entity';
import { Document } from './document.entity';
import { Notification } from './notification.entity';
import { UserNotificationSettings } from './user-notification-settings.entity';

/**
 * Roles de usuário no sistema
 * - ADMIN: Administrador da conta/clínica (gerencia usuários e plano)
 * - COLLABORATOR: Colaborador criado por um admin
 *
 * "Médico" não é um role — é definido pela existência de um doctorProfile.
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

@Entity('users')
@Index('idx_users_owner_id', ['ownerId'])
@Index('idx_users_admin_id', ['adminId'])
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

  @Column({ type: 'varchar', length: 160, unique: true })
  email: string;

  @Exclude()
  @Column({ type: 'varchar', length: 60, nullable: true, select: false })
  password: string | null;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 14, nullable: true })
  cpf: string | null;

  @Column({ type: 'varchar', length: 9, nullable: true })
  cep: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  address: string | null;

  @Column({
    name: 'address_number',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  addressNumber: string | null;

  @Column({
    name: 'address_complement',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  addressComplement: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 2, nullable: true })
  state: string | null;

  @Column({ type: 'char', length: 1, nullable: true })
  gender: string | null;

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate: Date | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 255, nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'email_verified', type: 'boolean', default: false })
  emailVerified: boolean;

  @Column({ name: 'email_verified_at', type: 'timestamp', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({
    name: 'email_verification_token',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  emailVerificationToken: string | null;

  @Column({
    name: 'email_verification_expires_at',
    type: 'timestamp',
    nullable: true,
  })
  emailVerificationExpiresAt: Date | null;

  /**
   * ownerId: FK auto-referenciante para o usuário Admin dono da conta/clínica.
   * Garante isolamento de tenant — todos os usuários da mesma conta
   * compartilham o mesmo ownerId. Para Admins, ownerId = self.id.
   */
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'admin_id', type: 'uuid', nullable: true })
  adminId: string | null;

  // ============ CONSENTIMENTOS LGPD ============
  // Aceitação simples: timestamp do aceite ou NULL se ainda não aceitou.
  // Política e Termos são obrigatórios para usar a plataforma.
  // IA é opcional — sem ela o usuário não usa o assistente do WhatsApp.
  @Column({
    name: 'privacy_policy_accepted_at',
    type: 'timestamptz',
    nullable: true,
  })
  privacyPolicyAcceptedAt: Date | null;

  @Column({
    name: 'terms_of_use_accepted_at',
    type: 'timestamptz',
    nullable: true,
  })
  termsOfUseAcceptedAt: Date | null;

  @Column({
    name: 'ai_consent_accepted_at',
    type: 'timestamptz',
    nullable: true,
  })
  aiConsentAcceptedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  // ============ RELAÇÕES ============

  // Conta/clínica raiz (particionamento por tenant) — self-referencing
  // nullable: true é necessário no TypeORM para evitar CircularRelationsError
  // na prática o DB garante NOT NULL via migration
  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  // Admin que criou este usuário (self-referencing, para colaboradores)
  @ManyToOne(() => User, (user) => user.managedUsers, { nullable: true })
  @JoinColumn({ name: 'admin_id' })
  admin: User | null;

  // Usuários gerenciados por este Admin
  @OneToMany(() => User, (user) => user.admin)
  managedUsers: User[];

  // Perfil de médico (1:1) — existe se o usuário é médico
  @OneToOne(() => DoctorProfile, (profile) => profile.user, { cascade: true })
  doctorProfile: DoctorProfile | null;

  // Médicos que este usuário acessa (vínculos ativos em user_doctor_access)
  @OneToMany(() => UserDoctorAccess, (uda) => uda.user)
  doctorAccesses: UserDoctorAccess[];

  // Quem acessa este usuário como médico (inverso do vínculo)
  @OneToMany(() => UserDoctorAccess, (uda) => uda.doctor)
  accessibleBy: UserDoctorAccess[];

  // Códigos de recuperação de senha
  @OneToMany(() => RecoveryCode, (code) => code.user)
  recoveryCodes: RecoveryCode[];

  // Documentos inseridos
  @OneToMany(() => Document, (document) => document.creator)
  insertedDocuments: Document[];

  // Notificações
  @OneToMany(() => Notification, (notification) => notification.user)
  notifications: Notification[];

  // Configurações de notificação
  @OneToOne(() => UserNotificationSettings, (settings) => settings.user)
  notificationSettings: UserNotificationSettings;

  // ============ PROPRIEDADE VIRTUAL ============

  /**
   * Indica se o usuário é médico.
   * Baseado na existência de doctorProfile (precisa ser carregado via relation).
   * Usado apenas para serialização no response, NÃO para lógica interna.
   */
  get isDoctor(): boolean {
    return !!this.doctorProfile;
  }
}
