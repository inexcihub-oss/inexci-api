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

@Entity('doctor_headers')
export class DoctorHeader {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'doctor_profile_id', type: 'uuid', unique: true })
  doctorProfileId: string;

  @Column({ name: 'logo_url', type: 'varchar', length: 500, nullable: true })
  logoUrl: string | null;

  @Column({
    name: 'logo_position',
    type: 'enum',
    enum: ['left', 'center', 'right'],
    default: 'left',
  })
  logoPosition: 'left' | 'center' | 'right';

  @Column({ name: 'content_html', type: 'text', nullable: true })
  contentHtml: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(() => DoctorProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_profile_id' })
  doctorProfile: DoctorProfile;
}
