import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
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

  async getSettings(userId: string) {
    let settings = await this.settingsRepository.findByUserId(userId);

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
        mentionEmails: true,
      });
    }

    return settings;
  }

  async updateSettings(userId: string, data: UpdateNotificationSettingsDto) {
    return await this.settingsRepository.upsert(userId, data);
  }

  async getNotifications(
    userId: string,
    options?: { skip?: number; take?: number; unreadOnly?: boolean },
  ) {
    const [notifications, unreadCount, total] = await Promise.all([
      this.notificationRepository.findByUserId(userId, options),
      this.notificationRepository.countUnread(userId),
      this.notificationRepository.countByUserId(userId, {
        unreadOnly: options?.unreadOnly,
      }),
    ]);

    return {
      notifications,
      unreadCount,
      total,
    };
  }

  async markAsRead(
    notificationId: string,
    userId: string,
  ): Promise<MessageResponse> {
    const affected = await this.notificationRepository.markAsRead(
      notificationId,
      userId,
    );
    if (affected === 0) {
      throw new NotFoundException('Notificação não encontrada');
    }
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
    const affected = await this.notificationRepository.deleteByUser(
      notificationId,
      userId,
    );
    if (affected === 0) {
      throw new NotFoundException('Notificação não encontrada');
    }
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

  async notifyAppointmentPatientResponse(params: {
    appointmentId: string;
    ownerId: string;
    doctorId: string;
    patientName: string;
    when: string;
    response: 'confirmed' | 'cancelled';
  }): Promise<void> {
    try {
      const usuariosDaConta = await this.userRepository.findByOwnerId(
        params.ownerId,
      );

      const acessos = await Promise.all(
        usuariosDaConta.map(async (u) => {
          try {
            const doctorIds =
              (await this.accessControlService?.getAccessibleDoctorIds(u.id)) ??
              [];
            return doctorIds.includes(params.doctorId) ? u.id : null;
          } catch {
            return null;
          }
        }),
      );

      const destinatarios = [
        ...new Set([
          params.doctorId,
          ...acessos.filter((id): id is string => Boolean(id)),
        ]),
      ];

      const confirmou = params.response === 'confirmed';
      const title = confirmou
        ? 'Consulta confirmada pelo paciente'
        : 'Consulta cancelada pelo paciente';
      const message = confirmou
        ? `${params.patientName} confirmou presença na consulta de ${params.when} pelo WhatsApp.`
        : `${params.patientName} cancelou a consulta de ${params.when} pelo WhatsApp.`;

      await this.createNotificationForUsers(destinatarios, {
        type: NotificationType.STATUS_UPDATE,
        title,
        message,
        link: '/agenda',
        metadata: {
          appointmentId: params.appointmentId,
          doctorId: params.doctorId,
          response: params.response,
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `Falha ao notificar resposta do paciente à consulta ${params.appointmentId}: ${err?.message}`,
      );
    }
  }

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
