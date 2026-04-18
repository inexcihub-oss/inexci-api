import { Injectable, Logger } from '@nestjs/common';
import { NotificationRepository } from 'src/database/repositories/notification.repository';
import { UserNotificationSettingsRepository } from 'src/database/repositories/user-notification-settings.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { MailService } from 'src/shared/mail/mail.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { NotificationType } from 'src/database/entities/notification.entity';

export interface DispatchNotificationDto {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, any>;
  /** Sobrescreve preferências — força envio de e-mail */
  forceEmail?: boolean;
  /** Dados para e-mail (se não informado, usa sendRaw com title+message) */
  emailSubject?: string;
  emailHtml?: string;
  /** Dados para WhatsApp template */
  whatsappContentSid?: string;
  whatsappVariables?: Record<string, string>;
}

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly settingsRepository: UserNotificationSettingsRepository,
    private readonly userRepository: UserRepository,
    private readonly mailService: MailService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async dispatch(dto: DispatchNotificationDto): Promise<void> {
    const { userId } = dto;

    // 1. Criar registro in-app
    let inAppCreated = false;
    try {
      const settings = await this.getSettings(userId);
      const typeEnabled = this.isTypeEnabled(settings, dto.type);

      if (settings?.push_notifications !== false && typeEnabled) {
        await this.notificationRepository.create({
          user_id: userId,
          type: dto.type,
          title: dto.title,
          message: dto.message,
          link: dto.link,
          metadata: dto.metadata,
        });
        inAppCreated = true;
      }
    } catch (err: any) {
      this.logger.warn(
        `Falha ao criar notificação in-app para ${userId}: ${err?.message}`,
      );
    }

    // 2. E-mail (se habilitado)
    try {
      const settings = await this.getSettings(userId);
      const shouldEmail =
        dto.forceEmail ||
        (settings?.email_notifications &&
          this.isTypeEnabled(settings, dto.type));

      if (shouldEmail) {
        const user = await this.userRepository.findOne({ id: userId });
        if (user?.email) {
          if (dto.emailHtml) {
            await this.mailService.sendRaw(
              user.email,
              dto.emailSubject ?? dto.title,
              dto.emailHtml,
            );
          } else {
            await this.mailService.sendRaw(
              user.email,
              dto.title,
              `<p>${dto.message}</p>${dto.link ? `<p><a href="${dto.link}">Ver detalhes</a></p>` : ''}`,
            );
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `Falha ao enviar e-mail para ${userId}: ${err?.message}`,
      );
    }

    // 3. WhatsApp (se habilitado e template fornecido)
    try {
      if (dto.whatsappContentSid) {
        const settings = await this.getSettings(userId);
        if (settings?.whatsapp_notifications !== false) {
          const user = await this.userRepository.findOne({ id: userId });
          if (user?.phone) {
            await this.whatsappService.sendTemplate(
              user.phone,
              dto.whatsappContentSid,
              dto.whatsappVariables ?? {},
            );
          }
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
        return settings.new_surgery_request !== false;
      case NotificationType.STATUS_UPDATE:
        return settings.status_update !== false;
      case NotificationType.PENDENCY:
        return settings.pendencies !== false;
      case NotificationType.EXPIRING_DOCUMENT:
        return settings.expiring_documents !== false;
      default:
        return true;
    }
  }
}
