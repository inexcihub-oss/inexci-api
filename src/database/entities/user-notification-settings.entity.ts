import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_notification_settings')
export class UserNotificationSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  user_id: string;

  // Canais de notificação
  @Column({ type: 'boolean', default: true })
  email_notifications: boolean;

  @Column({ type: 'boolean', default: false })
  sms_notifications: boolean;

  @Column({ type: 'boolean', default: true })
  push_notifications: boolean;

  // Tipos de notificação
  @Column({ type: 'boolean', default: true })
  new_surgery_request: boolean;

  @Column({ type: 'boolean', default: true })
  status_update: boolean;

  @Column({ type: 'boolean', default: true })
  pendencies: boolean;

  @Column({ type: 'boolean', default: true })
  expiring_documents: boolean;

  @Column({ type: 'boolean', default: false })
  weekly_report: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Relations
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
