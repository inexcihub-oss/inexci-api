import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_notification_settings')
export class UserNotificationSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  // Canais de notificação para usuários do sistema:
  //  - Push: in-app + WebSocket
  //  - WhatsApp: enviado pelo workflow para mudanças de status críticas
  // E-mail não é usado para notificações de status; o único e-mail
  // enviado é o resumo semanal (controlado por `weeklyReport`).
  @Column({ name: 'push_notifications', type: 'boolean', default: true })
  pushNotifications: boolean;

  @Column({ name: 'whatsapp_notifications', type: 'boolean', default: true })
  whatsappNotifications: boolean;

  // Tipos de notificação
  @Column({ name: 'new_surgery_request', type: 'boolean', default: true })
  newSurgeryRequest: boolean;

  @Column({ name: 'status_update', type: 'boolean', default: true })
  statusUpdate: boolean;

  @Column({ type: 'boolean', default: true })
  pendencies: boolean;

  @Column({ name: 'expiring_documents', type: 'boolean', default: true })
  expiringDocuments: boolean;

  @Column({ name: 'weekly_report', type: 'boolean', default: false })
  weeklyReport: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @OneToOne(() => User, (user) => user.notificationSettings, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
