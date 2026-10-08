import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Avisos automáticos que a conta (tenant) manda ao **paciente** — diferente de
 * `UserNotificationSettings`, que é a preferência pessoal de cada usuário.
 * Uma linha por conta, chaveada pelo `owner_id`; sem linha, tudo ligado.
 * Só quem tem `Permission.ADMINISTRACAO` altera.
 */
@Entity('patient_notification_settings')
export class PatientNotificationSettings {
  @PrimaryColumn({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  /** WhatsApp avisando que a consulta foi marcada, remarcada ou reativada. */
  @Column({ name: 'appointment_scheduled', type: 'boolean', default: true })
  appointmentScheduled: boolean;

  /** Lembrete 24h antes: e-mail + WhatsApp com os botões de confirmar/cancelar. */
  @Column({ name: 'appointment_reminder', type: 'boolean', default: true })
  appointmentReminder: boolean;

  /** WhatsApp avisando que a consulta foi cancelada. */
  @Column({ name: 'appointment_cancelled', type: 'boolean', default: true })
  appointmentCancelled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;
}
