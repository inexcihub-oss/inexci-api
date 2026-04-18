import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MessageResponse } from 'src/shared/types/api-responses';
import { NotificationRepository } from 'src/database/repositories/notification.repository';
import { UserNotificationSettingsRepository } from 'src/database/repositories/user-notification-settings.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import { NotificationType } from 'src/database/entities/notification.entity';
import { UserRole } from 'src/database/entities/user.entity';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';
import { MailService } from 'src/shared/mail/mail.service';
import { getStatusLabel } from 'src/shared/utils';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly settingsRepository: UserNotificationSettingsRepository,
    private readonly userRepository: UserRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly mailService: MailService,
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
        whatsapp_notifications: true,
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

  async markAsRead(
    notificationId: string,
    userId: string,
  ): Promise<MessageResponse> {
    await this.notificationRepository.markAsRead(notificationId, userId);
    return { message: 'Notificação marcada como lida' };
  }

  async markAllAsRead(userId: string): Promise<MessageResponse> {
    await this.notificationRepository.markAllAsRead(userId);
    return { message: 'Todas as notificações marcadas como lidas' };
  }

  async deleteNotification(
    notificationId: string,
    userId: string,
  ): Promise<MessageResponse> {
    await this.notificationRepository.deleteByUser(notificationId, userId);
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

    await Promise.all(
      userIds.map((userId) =>
        this.sendEmailIfEnabled(
          userId,
          created.find((n) => n.user_id === userId),
        ),
      ),
    );

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

      await this.mailService.sendRaw(
        user.email,
        notification.title,
        `
          <p>Olá, <strong>${user.name}</strong></p>
          <p>${notification.message}</p>
          ${notification.link ? `<p><a href="${notification.link}">Clique aqui para mais detalhes</a></p>` : ''}
        `,
      );
    } catch (error) {
      this.logger.error('Erro ao enviar e-mail de notificacao', error);
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

  notifyStatusUpdate(
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

  notifyNewPendency(
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

  notifyExpiringDocument(
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

  /**
   * Notifica todos os envolvidos numa solicitação cirúrgica sobre uma mudança de status.
   * Envolvidos = médico + criador + admins da conta + usuários com atividade registrada.
   * O próprio ator não recebe notificação.
   */
  async notifyStatusChange(
    surgeryRequestId: string,
    doctorId: string,
    createdById: string,
    oldStatus: SurgeryRequestStatus,
    newStatus: SurgeryRequestStatus,
    actorId: string,
  ): Promise<void> {
    try {
      const actor = await this.userRepository.findOne({ id: actorId });
      if (!actor) return;

      const [allUsersInAccount, activityUserIds] = await Promise.all([
        this.userRepository.findByAccountId(actor.account_id),
        this.surgeryRequestRepository.findDistinctActivityUserIds(
          surgeryRequestId,
        ),
      ]);

      const adminIds = allUsersInAccount
        .filter((u) => u.role === UserRole.ADMIN)
        .map((u) => u.id);

      const stakeholderIds = [
        ...new Set([doctorId, createdById, ...adminIds, ...activityUserIds]),
      ].filter((id) => id && id !== actorId);

      if (!stakeholderIds.length) return;

      const oldLabel = getStatusLabel(oldStatus);
      const newLabel = getStatusLabel(newStatus);

      await this.createNotificationForUsers(stakeholderIds, {
        type: NotificationType.STATUS_UPDATE,
        title: 'Status da Solicitação Atualizado',
        message: `Status alterado de "${oldLabel}" para "${newLabel}"`,
        link: `/solicitacoes/${surgeryRequestId}`,
        metadata: { surgeryRequestId, oldStatus, newStatus },
      });

      // Enviar e-mail com template para stakeholders com e-mail habilitado
      const changedAt = new Date().toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const request = await this.surgeryRequestRepository.findOneWithRelations(
        { id: surgeryRequestId },
        ['patient'],
      );
      const patientName = request?.patient?.name ?? 'Paciente';

      await Promise.all(
        stakeholderIds.map(async (uid) => {
          try {
            const [settings, user] = await Promise.all([
              this.settingsRepository.findByUserId(uid),
              this.userRepository.findOne({ id: uid }),
            ]);
            if (!settings?.email_notifications || !user?.email) return;
            await this.mailService.sendStatusChangeStakeholder(user.email, {
              patientName,
              oldStatus: oldLabel,
              newStatus: newLabel,
              changedBy: actor.name ?? 'Usuário',
              changedAt,
              dashboardUrl: `/solicitacoes/${surgeryRequestId}`,
            });
          } catch (emailErr: any) {
            this.logger.warn(
              `Falha ao enviar e-mail de status para ${uid}: ${emailErr?.message}`,
            );
          }
        }),
      );
    } catch (err: any) {
      this.logger.warn(
        `Falha ao notificar envolvidos sobre mudança de status: ${err?.message}`,
      );
    }
  }

  /**
   * Notifica todos os admins da conta sobre uma ação realizada por um usuário.
   * O próprio ator não recebe notificação.
   */
  async notifyAdminsOfAction(
    actorId: string,
    title: string,
    message: string,
    link?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      const actor = await this.userRepository.findOne({ id: actorId });
      if (!actor) return;

      const allUsersInAccount = await this.userRepository.findByAccountId(
        actor.account_id,
      );

      const adminIds = allUsersInAccount
        .filter((u) => u.role === UserRole.ADMIN && u.id !== actorId)
        .map((u) => u.id);

      if (!adminIds.length) return;

      await this.createNotificationForUsers(adminIds, {
        type: NotificationType.ACTION_BY_USER,
        title,
        message,
        link,
        metadata,
      });
    } catch (err: any) {
      this.logger.warn(`Falha ao notificar admins: ${err?.message}`);
    }
  }
}
