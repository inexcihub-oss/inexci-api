import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationRepository } from 'src/database/repositories/notification.repository';
import { UserNotificationSettingsRepository } from 'src/database/repositories/user-notification-settings.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { NotificationType } from 'src/database/entities/notification.entity';
import { NotificationsGateway } from './notifications.gateway';

export interface DispatchNotificationDto {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, any>;
  /** Dados para WhatsApp template (opcional) */
  whatsappContentSid?: string;
  whatsappVariables?: Record<string, string>;
}

/**
 * Despacha notificações para usuários do sistema respeitando suas preferências.
 *
 * Canais suportados:
 *  - Push (in-app + WebSocket): controlado por `pushNotifications` + tipo
 *  - WhatsApp: controlado por `whatsappNotifications` + tipo (quando um
 *    `whatsappContentSid` é fornecido)
 *
 * E-mail não é mais um canal de notificação para usuários do sistema. O único
 * e-mail enviado é o resumo semanal (`WeeklySummaryService`).
 */
@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly settingsRepository: UserNotificationSettingsRepository,
    private readonly userRepository: UserRepository,
    private readonly whatsappService: WhatsappService,
    @Optional() private readonly notificationsGateway: NotificationsGateway,
  ) {}

  async dispatch(dto: DispatchNotificationDto): Promise<void> {
    const { userId } = dto;
    const settings = await this.getSettings(userId);
    const typeEnabled = this.isTypeEnabled(settings, dto.type);

    // Push (in-app + WS)
    try {
      if (settings?.pushNotifications !== false && typeEnabled) {
        const notification = await this.notificationRepository.create({
          userId: userId,
          type: dto.type,
          title: dto.title,
          message: dto.message,
          link: dto.link,
          metadata: dto.metadata,
        });
        this.notificationsGateway?.emitToUser(userId, {
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          link: notification.link,
          metadata: notification.metadata,
          createdAt: notification.createdAt,
        });
      }
    } catch (err: any) {
      this.logger.warn(
        `Falha ao criar notificação in-app para ${userId}: ${err?.message}`,
      );
    }

    // WhatsApp
    try {
      if (
        dto.whatsappContentSid &&
        typeEnabled &&
        settings?.whatsappNotifications !== false
      ) {
        const user = await this.userRepository.findOne({ id: userId });
        if (user?.phone) {
          await this.whatsappService.sendTemplate(
            user.phone,
            dto.whatsappContentSid,
            dto.whatsappVariables ?? {},
          );
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `Falha ao enviar WhatsApp para ${userId}: ${err?.message}`,
      );
    }
  }

  async dispatchToMany(
    userIds: string[],
    data: Omit<DispatchNotificationDto, 'userId'>,
  ): Promise<void> {
    await Promise.all(
      userIds.map((userId) => this.dispatch({ ...data, userId })),
    );
  }

  private getSettings(userId: string) {
    return this.settingsRepository.findByUserId(userId);
  }

  private isTypeEnabled(settings: any, type: NotificationType): boolean {
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
}
