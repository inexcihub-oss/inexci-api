import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export enum UserDoctorAccessStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('user_doctor_accesses')
@Unique(['userId', 'doctorUserId'])
@Index('idx_uda_user_status', ['userId', 'status'])
@Index('idx_uda_doctor_status', ['doctorUserId', 'status'])
export class UserDoctorAccess {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'doctor_user_id', type: 'uuid' })
  doctorUserId: string;

  @Column({
    type: 'enum',
    enum: UserDoctorAccessStatus,
    default: UserDoctorAccessStatus.ACTIVE,
  })
  status: UserDoctorAccessStatus;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.doctorAccesses, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => User, (user) => user.accessibleBy, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_user_id' })
  doctor: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;
}
