import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SurgeryRequestActivity } from './surgery-request-activity.entity';
import { User } from './user.entity';

/**
 * Menção (@) feita a um usuário dentro de um comentário da solicitação.
 *
 * Tabela em vez de um `jsonb` na própria atividade porque cada menção tem
 * ciclo de vida próprio: a notificação in-app criada para ela
 * (`notification_id`, usada para saber se já foi lida) e o e-mail atrasado
 * (`email_sent_at`, que garante envio único). Um `jsonb` obrigaria a
 * reescrever a linha inteira da atividade a cada passo desse ciclo.
 *
 * `notification_id` é `ON DELETE SET NULL`: o usuário pode apagar a
 * notificação da central antes dos 10 minutos, e isso não pode apagar o
 * registro da menção nem quebrar o job de e-mail.
 */
@Entity('surgery_request_activity_mentions')
export class SurgeryRequestActivityMention {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'activity_id', type: 'uuid' })
  activityId: string;

  @Column({ name: 'mentioned_user_id', type: 'uuid' })
  mentionedUserId: string;

  @Column({ name: 'notification_id', type: 'uuid', nullable: true })
  notificationId: string | null;

  @Column({ name: 'email_sent_at', type: 'timestamptz', nullable: true })
  emailSentAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => SurgeryRequestActivity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'activity_id' })
  activity: SurgeryRequestActivity;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'mentioned_user_id' })
  mentionedUser: User;
}
