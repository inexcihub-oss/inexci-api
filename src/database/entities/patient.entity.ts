import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { HealthPlan } from './health-plan.entity';
import { SurgeryRequest } from './surgery-request.entity';

@Entity('patients')
@Index('idx_patients_doctor_id', ['doctorId'])
@Index('idx_patients_owner_id', ['ownerId'])
@Index('UQ_patients_photo_path', ['photoPath'], {
  unique: true,
  where: 'photo_path IS NOT NULL',
})
export class Patient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  phone: string | null;

  @Column({
    name: 'secondary_phone',
    type: 'varchar',
    length: 15,
    nullable: true,
  })
  secondaryPhone: string | null;

  @Column({ type: 'varchar', length: 14, nullable: true })
  cpf: string | null;

  @Column({ name: 'photo_path', type: 'varchar', length: 255, nullable: true })
  photoPath: string | null;

  @Column({ type: 'char', length: 1, nullable: true })
  gender: string | null;

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate: Date | null;

  @Column({ name: 'health_plan_id', type: 'uuid', nullable: true })
  healthPlanId: string | null;

  @Column({
    name: 'health_plan_number',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  healthPlanNumber: string | null;

  @Column({
    name: 'health_plan_type',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  healthPlanType: string | null;

  @Column({ name: 'zip_code', type: 'varchar', length: 10, nullable: true })
  zipCode: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  address: string | null;

  @Column({
    name: 'address_number',
    type: 'varchar',
    length: 20,
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
  neighborhood: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'char', length: 2, nullable: true })
  state: string | null;

  @Column({ name: 'medical_notes', type: 'text', nullable: true })
  medicalNotes: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor: User;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @ManyToOne(() => HealthPlan, (hp) => hp.patients, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'health_plan_id' })
  healthPlan: HealthPlan | null;

  @OneToMany(() => SurgeryRequest, (sr) => sr.patient)
  surgeryRequests: SurgeryRequest[];
}
