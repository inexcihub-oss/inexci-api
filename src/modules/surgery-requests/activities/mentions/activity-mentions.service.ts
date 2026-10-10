import { Injectable, Logger } from '@nestjs/common';
import { SurgeryRequestActivityMentionRepository } from 'src/database/repositories/surgery-request-activity-mention.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { NotificationDispatcherService } from 'src/modules/notifications/notification-dispatcher.service';
import { NotificationType } from 'src/database/entities/notification.entity';
import { MentionEmailsJobsService } from './mention-emails-jobs.service';
import { errorMessage } from 'src/shared/utils/error-message.util';

export interface RegisterMentionsParams {
  activityId: string;
  surgeryRequestId: string;
  doctorUserId: string;
  ownerId: string;
  authorId: string;
  authorName: string;
  content: string;
  mentionedUserIds: string[];
}

export interface MentionedUserSummary {
  id: string;
  name: string;
}

const TAMANHO_PREVIA = 140;

@Injectable()
export class ActivityMentionsService {
  private readonly logger = new Logger(ActivityMentionsService.name);

  constructor(
    private readonly mentionRepository: SurgeryRequestActivityMentionRepository,
    private readonly accessControlService: AccessControlService,
    private readonly notificationDispatcher: NotificationDispatcherService,
    private readonly mentionEmailsJobs: MentionEmailsJobsService,
  ) {}

  async register(
    params: RegisterMentionsParams,
  ): Promise<MentionedUserSummary[]> {
    const solicitados = [...new Set(params.mentionedUserIds ?? [])].filter(
      (id) => id && id !== params.authorId,
    );
    if (solicitados.length === 0) return [];

    try {
      const permitidos =
        await this.accessControlService.getUsersWithAccessToDoctor(
          params.doctorUserId,
          params.ownerId,
        );
      const porId = new Map(permitidos.map((u) => [u.id, u]));

      const validos = solicitados.filter((id) => porId.has(id));
      if (validos.length === 0) return [];

      const mentions = await this.mentionRepository.createMany(
        params.activityId,
        validos,
      );

      await Promise.all(
        mentions.map((mention) => this.avisar(mention, params)),
      );

      return validos.map((id) => ({
        id,
        name: porId.get(id)?.name ?? '',
      }));
    } catch (err) {
      this.logger.warn(
        `[MENCAO] Falha ao registrar menções da atividade ${params.activityId}: ${errorMessage(err)}`,
      );
      return [];
    }
  }

  private async avisar(
    mention: { id: string; mentionedUserId: string },
    params: RegisterMentionsParams,
  ): Promise<void> {
    try {
      const notification = await this.notificationDispatcher.dispatch({
        userId: mention.mentionedUserId,
        type: NotificationType.MENTION,
        title: `${params.authorName} mencionou você`,
        message: this.previa(params.content),
        link: `/solicitacao/${params.surgeryRequestId}?sidebar=atividades`,
        metadata: {
          category: 'mention',
          activityId: params.activityId,
          surgeryRequestId: params.surgeryRequestId,
          actorId: params.authorId,
          actorName: params.authorName,
        },
      });

      if (notification) {
        await this.mentionRepository.setNotificationId(
          mention.id,
          notification.id,
        );
      }

      await this.mentionEmailsJobs.schedule({
        mentionId: mention.id,
        surgeryRequestId: params.surgeryRequestId,
        authorName: params.authorName,
        content: params.content,
        inAppNotified: Boolean(notification),
      });
    } catch (err) {
      this.logger.warn(
        `[MENCAO] Falha ao avisar ${mention.mentionedUserId} da atividade ${params.activityId}: ${errorMessage(err)}`,
      );
    }
  }

  private previa(content: string): string {
    const limpo = content.trim();
    const texto =
      limpo.length > TAMANHO_PREVIA
        ? `${limpo.slice(0, TAMANHO_PREVIA)}…`
        : limpo;
    return `"${texto}"`;
  }
}
