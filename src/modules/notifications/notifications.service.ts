import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationRepository } from 'src/database/repositories/notification.repository';
import { UserNotificationSettingsRepository } from 'src/database/repositories/user-notification-settings.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import { NotificationType } from 'src/database/entities/notification.entity';
import { EmailService } from 'src/shared/email/email.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly settingsRepository: UserNotificationSettingsRepository,
    private readonly userRepository: UserRepository,
    private readonly emailService: EmailService,
  ) {}

  // ============ Settings ============

  async getSettings(userId: string) {
    let settings = await this.settingsRepository.findByUserId(userId);

    // Se não existir, cria com valores padrão
    if (!settings) {
      settings = await this.settingsRepository.create({
        user_id: userId,
        email_notifications: true,
        sms_notifications: false,
        push_notifications: true,
        new_surgery_request: true,
        status_update: true,
        pendencies: true,
        expiring_documents: true,
        weekly_report: false,
      });
    }

    return settings;
  }

  async updateSettings(userId: string, data: UpdateNotificationSettingsDto) {
    return await this.settingsRepository.upsert(userId, data);
  }

  // ============ Notifications ============

  async getNotifications(
    userId: string,
    options?: { skip?: number; take?: number; unreadOnly?: boolean },
  ) {
    const [notifications, unreadCount] = await Promise.all([
      this.notificationRepository.findByUserId(userId, options),
      this.notificationRepository.countUnread(userId),
    ]);

    return {
      notifications,
      unreadCount,
      total: notifications.length,
    };
  }

  async getUnreadCount(userId: string) {
    return await this.notificationRepository.countUnread(userId);
  }

  async markAsRead(notificationId: string, userId: string) {
    await this.notificationRepository.markAsRead(notificationId, userId);
    return { message: 'Notificação marcada como lida' };
  }

  async markAllAsRead(userId: string) {
    await this.notificationRepository.markAllAsRead(userId);
    return { message: 'Todas as notificações marcadas como lidas' };
  }

  async deleteNotification(notificationId: string, userId: string) {
    await this.notificationRepository.delete(notificationId, userId);
    return { message: 'Notificação removida' };
  }

  // ============ Create Notifications ============

  async createNotification(data: CreateNotificationDto) {
    const notification = await this.notificationRepository.create({
      user_id: data.user_id,
      type: data.type || NotificationType.INFO,
      title: data.title,
      message: data.message,
      link: data.link,
      metadata: data.metadata,
    });

    // Verifica preferências do usuário e envia e-mail se habilitado
    await this.sendEmailIfEnabled(data.user_id, notification);

    return notification;
  }

  async createNotificationForUsers(
    userIds: string[],
    data: Omit<CreateNotificationDto, 'user_id'>,
  ) {
    const notifications = userIds.map((userId) => ({
      user_id: userId,
      type: data.type || NotificationType.INFO,
      title: data.title,
      message: data.message,
      link: data.link,
      metadata: data.metadata,
    }));

    const created = await this.notificationRepository.createBulk(notifications);

    // Envia e-mails para usuários com preferência habilitada
    for (const userId of userIds) {
      await this.sendEmailIfEnabled(
        userId,
        created.find((n) => n.user_id === userId),
      );
    }

    return created;
  }

  // ============ Notification Helpers ============

  private async sendEmailIfEnabled(userId: string, notification: any) {
    try {
      const settings = await this.settingsRepository.findByUserId(userId);

      if (!settings?.email_notifications) return;

      // Verifica se o tipo de notificação está habilitado
      const typeEnabled = this.isNotificationTypeEnabled(
        settings,
        notification.type,
      );
      if (!typeEnabled) return;

      const user = await this.userRepository.findOne({ id: userId });
      if (!user?.email) return;

      await this.emailService.send(
        user.email,
        notification.title,
        `
          <p>Olá, <strong>${user.name}</strong></p>
          <p>${notification.message}</p>
          ${notification.link ? `<p><a href="${notification.link}">Clique aqui para mais detalhes</a></p>` : ''}
        `,
      );
    } catch (error) {
      console.error('Erro ao enviar e-mail de notificação:', error);
    }
  }

  private isNotificationTypeEnabled(
    settings: any,
    type: NotificationType,
  ): boolean {
    switch (type) {
      case NotificationType.NEW_SURGERY_REQUEST:
        return settings.new_surgery_request;
      case NotificationType.STATUS_UPDATE:
        return settings.status_update;
      case NotificationType.PENDENCY:
        return settings.pendencies;
      case NotificationType.EXPIRING_DOCUMENT:
        return settings.expiring_documents;
      default:
        return true;
    }
  }

  // ============ Convenience Methods ============

  async notifyStatusUpdate(
    userId: string,
    surgeryRequestId: string,
    newStatus: string,
  ) {
    return this.createNotification({
      user_id: userId,
      type: NotificationType.STATUS_UPDATE,
      title: 'Status Atualizado',
      message: `A solicitação cirúrgica foi atualizada para: ${newStatus}`,
      link: `/solicitacoes/${surgeryRequestId}`,
      metadata: { surgeryRequestId, newStatus },
    });
  }

  async notifyNewPendency(
    userId: string,
    surgeryRequestId: string,
    pendencyType: string,
  ) {
    return this.createNotification({
      user_id: userId,
      type: NotificationType.PENDENCY,
      title: 'Nova Pendência',
      message: `Uma nova pendência foi criada: ${pendencyType}`,
      link: `/solicitacoes/${surgeryRequestId}`,
      metadata: { surgeryRequestId, pendencyType },
    });
  }

  async notifyExpiringDocument(
    userId: string,
    documentName: string,
    daysUntilExpiry: number,
  ) {
    return this.createNotification({
      user_id: userId,
      type: NotificationType.EXPIRING_DOCUMENT,
      title: 'Documento Expirando',
      message: `O documento "${documentName}" expira em ${daysUntilExpiry} dias`,
      metadata: { documentName, daysUntilExpiry },
    });
  }
}
