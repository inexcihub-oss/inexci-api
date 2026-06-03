import { Injectable, Logger, Optional } from '@nestjs/common';
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
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { WHATSAPP_TEMPLATES } from 'src/shared/whatsapp/whatsapp-templates.constants';
import { getStatusLabel, getStalePendencyMessage } from 'src/shared/utils';
import { NotificationsGateway } from './notifications.gateway';
import { AccessControlService } from 'src/shared/services/access-control.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly settingsRepository: UserNotificationSettingsRepository,
    private readonly userRepository: UserRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly whatsappService: WhatsappService,
    @Optional() private readonly notificationsGateway: NotificationsGateway,
    @Optional() private readonly accessControlService?: AccessControlService,
  ) {}

  // ============ Settings ============

  async getSettings(userId: string) {
    let settings = await this.settingsRepository.findByUserId(userId);

    // Se não existir, cria com valores padrão
    if (!settings) {
      settings = await this.settingsRepository.create({
        userId: userId,
        pushNotifications: true,
        whatsappNotifications: true,
        newSurgeryRequest: true,
        statusUpdate: true,
        pendencies: true,
        expiringDocuments: true,
        weeklyReport: false,
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

  async markAsRead(
    notificationId: string,
    userId: string,
  ): Promise<MessageResponse> {
    await this.notificationRepository.markAsRead(notificationId, userId);
    await this.broadcastUnreadCount(userId);
    return { message: 'Notificação marcada como lida' };
  }

  async markAllAsRead(userId: string): Promise<MessageResponse> {
    await this.notificationRepository.markAllAsRead(userId);
    await this.broadcastUnreadCount(userId);
    return { message: 'Todas as notificações marcadas como lidas' };
  }

  async deleteNotification(
    notificationId: string,
    userId: string,
  ): Promise<MessageResponse> {
    await this.notificationRepository.deleteByUser(notificationId, userId);
    await this.broadcastUnreadCount(userId);
    return { message: 'Notificação removida' };
  }

  private async broadcastUnreadCount(userId: string): Promise<void> {
    if (!this.notificationsGateway) return;
    try {
      const count = await this.notificationRepository.countUnread(userId);
      this.notificationsGateway.emitUnreadCount(userId, count);
    } catch (err: any) {
      this.logger.warn(
        `Falha ao emitir unread-count para ${userId}: ${err?.message}`,
      );
    }
  }

  // ============ Create Notifications ============

  /**
   * Cria notificação in-app + emite via WebSocket (push) para o usuário.
   *
   * Política de canais para usuários do sistema (médico/admin/colaborador):
   *  - Push (in-app + WS): controlado por `pushNotifications` + tipo
   *  - WhatsApp: enviado pelos services específicos (notifyStatusChange,
   *    StaleNotificationService) consultando `resolveChannels`
   *  - E-mail: NUNCA é usado para notificações de status. O único e-mail
   *    enviado ao usuário é o resumo semanal (WeeklySummaryService).
   */
  async createNotification(data: CreateNotificationDto) {
    const type = data.type || NotificationType.INFO;
    const channels = await this.resolveChannels(data.userId, type);

    if (!channels.push) {
      return null;
    }

    const notification = await this.notificationRepository.create({
      userId: data.userId,
      type,
      title: data.title,
      message: data.message,
      link: data.link,
      metadata: data.metadata,
    });

    this.notificationsGateway?.emitToUser(notification.userId, {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      link: notification.link,
      metadata: notification.metadata,
      createdAt: notification.createdAt,
    });

    return notification;
  }

  async createNotificationForUsers(
    userIds: string[],
    data: Omit<CreateNotificationDto, 'userId'>,
  ) {
    const type = data.type || NotificationType.INFO;

    const channelsByUser = await Promise.all(
      userIds.map(async (uid) => ({
        userId: uid,
        channels: await this.resolveChannels(uid, type),
      })),
    );

    const pushUserIds = channelsByUser
      .filter((c) => c.channels.push)
      .map((c) => c.userId);

    if (!pushUserIds.length) return [];

    const created = await this.notificationRepository.createBulk(
      pushUserIds.map((uid) => ({
        userId: uid,
        type,
        title: data.title,
        message: data.message,
        link: data.link,
        metadata: data.metadata,
      })),
    );

    created.forEach((notification) => {
      this.notificationsGateway?.emitToUser(notification.userId, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        link: notification.link,
        metadata: notification.metadata,
        createdAt: notification.createdAt,
      });
    });

    return created;
  }

  // ============ Notification Helpers ============

  /**
   * Resolve quais canais (push/whatsapp) devem ser usados para um usuário
   * e tipo de notificação. Centraliza a leitura de preferências.
   *
   * Regras:
   *  - Se o usuário ainda não tem registro em `user_notification_settings`,
   *    todos os canais são considerados habilitados (default).
   *  - Se o tipo (`statusUpdate`, `pendencies`, etc.) está desligado,
   *    nenhum canal é usado.
   *  - Caso contrário, cada canal individual respeita sua própria flag.
   *
   * Nota: e-mail não é mais um canal de notificação para usuários do sistema.
   * O único e-mail enviado é o resumo semanal, controlado por `weeklyReport`.
   */
  async resolveChannels(
    userId: string,
    type: NotificationType,
  ): Promise<{ push: boolean; whatsapp: boolean }> {
    const settings = await this.settingsRepository.findByUserId(userId);
    const typeEnabled = this.isNotificationTypeEnabled(settings, type);

    if (!typeEnabled) {
      return { push: false, whatsapp: false };
    }

    return {
      push: settings?.pushNotifications !== false,
      whatsapp: settings?.whatsappNotifications !== false,
    };
  }

  private isNotificationTypeEnabled(
    settings: any,
    type: NotificationType,
  ): boolean {
    if (!settings) return true;
    switch (type) {
      case NotificationType.NEW_SURGERY_REQUEST:
        return settings.newSurgeryRequest !== false;
      case NotificationType.STATUS_UPDATE:
        return settings.statusUpdate !== false;
      case NotificationType.PENDENCY:
        return settings.pendencies !== false;
      case NotificationType.EXPIRING_DOCUMENT:
        return settings.expiringDocuments !== false;
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
      userId: userId,
      type: NotificationType.STATUS_UPDATE,
      title: 'Status Atualizado',
      message: `A solicitação cirúrgica foi atualizada para: ${newStatus}`,
      link: `/solicitacao/${surgeryRequestId}`,
      metadata: { surgeryRequestId, newStatus },
    });
  }

  notifyNewPendency(
    userId: string,
    surgeryRequestId: string,
    pendencyType: string,
  ) {
    return this.createNotification({
      userId: userId,
      type: NotificationType.PENDENCY,
      title: 'Nova Pendência',
      message: `Uma nova pendência foi criada: ${pendencyType}`,
      link: `/solicitacao/${surgeryRequestId}`,
      metadata: { surgeryRequestId, pendencyType },
    });
  }

  notifyExpiringDocument(
    userId: string,
    documentName: string,
    daysUntilExpiry: number,
  ) {
    return this.createNotification({
      userId: userId,
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
    options?: { sendWhatsapp?: boolean },
  ): Promise<void> {
    try {
      const actor = await this.userRepository.findOne({ id: actorId });
      if (!actor) return;

      const [allUsersInAccount, activityUserIds] = await Promise.all([
        this.userRepository.findByOwnerId(actor.ownerId),
        this.surgeryRequestRepository.findDistinctActivityUserIds(
          surgeryRequestId,
        ),
      ]);

      let accessibleUserIds: string[] = [];

      if (this.accessControlService) {
        const checks = await Promise.all(
          allUsersInAccount.map(async (u) => {
            try {
              const doctorIds =
                await this.accessControlService!.getAccessibleDoctorIds(u.id);
              return { userId: u.id, canAccess: doctorIds.includes(doctorId) };
            } catch {
              return { userId: u.id, canAccess: false };
            }
          }),
        );

        accessibleUserIds = checks
          .filter((c) => c.canAccess)
          .map((c) => c.userId);
      } else {
        const adminIds = allUsersInAccount
          .filter((u) => u.role === UserRole.ADMIN)
          .map((u) => u.id);
        accessibleUserIds = [...new Set([doctorId, createdById, ...adminIds])];
      }

      const stakeholderIds = [
        ...new Set([...accessibleUserIds, ...activityUserIds]),
      ].filter((id) => id && id !== actorId);

      if (!stakeholderIds.length) return;

      const oldLabel = getStatusLabel(oldStatus);
      const newLabel = getStatusLabel(newStatus);

      // Push (in-app + WS) — respeita pushNotifications + tipo
      await this.createNotificationForUsers(stakeholderIds, {
        type: NotificationType.STATUS_UPDATE,
        title: 'Status da Solicitação Atualizado',
        message: `Status alterado de "${oldLabel}" para "${newLabel}" por ${actor.name ?? 'usuário'}`,
        link: `/solicitacao/${surgeryRequestId}`,
        metadata: {
          surgeryRequestId,
          oldStatus,
          newStatus,
          actorId: actor.id,
          actorName: actor.name,
          actorAvatarUrl: actor.avatarUrl,
        },
      });

      const request = await this.surgeryRequestRepository.findOneWithRelations(
        { id: surgeryRequestId },
        ['patient'],
      );
      const patientName = request?.patient?.name ?? 'Paciente';
      const requestProtocol = request?.protocol ?? surgeryRequestId;
      const pendencyMessage = getStalePendencyMessage(newStatus);

      const shouldSendWhatsapp = options?.sendWhatsapp !== false;
      if (shouldSendWhatsapp) {
        // WhatsApp — respeita whatsappNotifications + tipo. E-mail não é mais
        // enviado para usuários do sistema em mudanças de status.
        await Promise.all(
          stakeholderIds.map(async (uid) => {
            try {
              const [channels, user] = await Promise.all([
                this.resolveChannels(uid, NotificationType.STATUS_UPDATE),
                this.userRepository.findOne({ id: uid }),
              ]);

              if (channels.whatsapp && user?.phone) {
                try {
                  await this.whatsappService.sendTemplate(
                    user.phone,
                    WHATSAPP_TEMPLATES.STATUS_CHANGE_USERS,
                    {
                      '1': user.name ?? 'Usuário',
                      '2': requestProtocol,
                      '3': newLabel,
                      '4': pendencyMessage,
                      '5': patientName,
                    },
                  );
                } catch (waErr: any) {
                  this.logger.warn(
                    `Falha ao enviar WhatsApp de status para ${uid}: ${waErr?.message}`,
                  );
                }
              }
            } catch (notifyErr: any) {
              this.logger.warn(
                `Falha ao notificar stakeholder ${uid}: ${notifyErr?.message}`,
              );
            }
          }),
        );
      }
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

      const allUsersInAccount = await this.userRepository.findByOwnerId(
        actor.ownerId,
      );

      const adminIds = allUsersInAccount
        .filter((u) => u.role === UserRole.ADMIN && u.id !== actorId)
        .map((u) => u.id);

      if (!adminIds.length) return;

      const actorMetadata = {
        actorId: actor.id,
        actorName: actor.name,
        actorAvatarUrl: actor.avatarUrl,
      };

      await this.createNotificationForUsers(adminIds, {
        type: NotificationType.ACTION_BY_USER,
        title,
        message,
        link,
        metadata: {
          ...(metadata ?? {}),
          ...actorMetadata,
        },
      });
    } catch (err: any) {
      this.logger.warn(`Falha ao notificar admins: ${err?.message}`);
    }
  }
}
