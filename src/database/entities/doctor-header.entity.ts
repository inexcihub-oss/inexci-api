import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { DoctorProfile } from './doctor-profile.entity';

@Entity('doctor_header')
export class DoctorHeader {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'doctor_profile_id', unique: true })
  doctor_profile_id: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  logo_url: string | null;

  @Column({
    type: 'enum',
    enum: ['left', 'right'],
    default: 'left',
  })
  logo_position: 'left' | 'right';

  @Column({ type: 'text', nullable: true })
  content_html: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToOne(() => DoctorProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_profile_id' })
  doctor_profile: DoctorProfile;
}
