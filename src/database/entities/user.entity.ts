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
import { Permission } from 'src/shared/permissions';
import { OnboardingState } from '../../modules/onboarding/onboarding.types';
import { PatientNotificationSettings } from '../../common/patient-notification-settings';
import { DoctorProfile } from './doctor-profile.entity';
import { UserDoctorAccess } from './user-doctor-access.entity';
import { RecoveryCode } from './recovery-code.entity';
import { Document } from './document.entity';
import { Notification } from './notification.entity';
import { UserNotificationSettings } from './user-notification-settings.entity';

export enum UserRole {
  ADMIN = 'admin',
  COLLABORATOR = 'collaborator',
}

export enum UserStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('users')
@Index('idx_users_owner_id', ['ownerId'])
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

  @Column({ type: 'varchar', length: 15 })
  phone: string;

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

  @Exclude()
  @Column({
    name: 'email_verification_token',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  emailVerificationToken: string | null;

  @Exclude()
  @Column({
    name: 'email_verification_expires_at',
    type: 'timestamp',
    nullable: true,
  })
  emailVerificationExpiresAt: Date | null;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'is_platform_admin', type: 'boolean', default: false })
  isPlatformAdmin: boolean;

  @Column({
    name: 'permissions',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  permissions: Permission[];

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

  @Column({ name: 'onboarding_state', type: 'jsonb', nullable: true })
  onboardingState: OnboardingState | null;

  @Column({
    name: 'patient_notification_settings',
    type: 'jsonb',
    nullable: true,
    select: false,
  })
  patientNotificationSettings: Partial<PatientNotificationSettings> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @OneToOne(() => DoctorProfile, (profile) => profile.user, { cascade: true })
  doctorProfile: DoctorProfile | null;

  @OneToMany(() => UserDoctorAccess, (uda) => uda.user)
  doctorAccesses: UserDoctorAccess[];

  @OneToMany(() => UserDoctorAccess, (uda) => uda.doctor)
  accessibleBy: UserDoctorAccess[];

  @OneToMany(() => RecoveryCode, (code) => code.user)
  recoveryCodes: RecoveryCode[];

  @OneToMany(() => Document, (document) => document.creator)
  insertedDocuments: Document[];

  @OneToMany(() => Notification, (notification) => notification.user)
  notifications: Notification[];

  @OneToOne(() => UserNotificationSettings, (settings) => settings.user)
  notificationSettings: UserNotificationSettings;

  get isDoctor(): boolean {
    return !!this.doctorProfile;
  }
}
