import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import { randomUUID } from 'crypto';
import { requestContextStorage } from 'src/shared/logging/request-context';
import { SurgeryRequestActivityMentionRepository } from 'src/database/repositories/surgery-request-activity-mention.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { NotificationRepository } from 'src/database/repositories/notification.repository';
import { UserNotificationSettingsRepository } from 'src/database/repositories/user-notification-settings.repository';
import { MailService } from 'src/shared/mail/mail.service';
import {
  MENTION_EMAILS_QUEUE,
  MentionEmailJobData,
  SEND_MENTION_EMAIL_JOB,
} from './mention-emails-jobs.service';

const TAMANHO_PREVIA = 240;

@Injectable()
@Processor(MENTION_EMAILS_QUEUE)
export class MentionEmailsProcessor {
  private readonly logger = new Logger(MentionEmailsProcessor.name);

  constructor(
    private readonly mentionRepository: SurgeryRequestActivityMentionRepository,
    private readonly notificationRepository: NotificationRepository,
    private readonly settingsRepository: UserNotificationSettingsRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  @Process(SEND_MENTION_EMAIL_JOB)
  async handleSend(job: Job<MentionEmailJobData>): Promise<void> {
    const requestId = job.data.requestId || randomUUID();
    return requestContextStorage.run({ requestId, userId: null }, () =>
      this.processSend(job),
    );
  }

  private async processSend(job: Job<MentionEmailJobData>): Promise<void> {
    const { mentionId, surgeryRequestId, authorName, content, inAppNotified } =
      job.data;

    const mention = await this.mentionRepository.findOneWithUser(mentionId);
    if (!mention) return;
    if (mention.emailSentAt) return;

    const destinatario = mention.mentionedUser;
    if (!destinatario?.email) {
      this.logger.warn(
        `[MENCAO] Usuário ${mention.mentionedUserId} sem e-mail; menção ${mentionId} fica só in-app.`,
      );
      return;
    }

    const settings = await this.settingsRepository.findByUserId(
      mention.mentionedUserId,
    );
    if (settings?.mentionEmails === false) return;

    if (mention.notificationId) {
      const notification = await this.notificationRepository.findOne({
        id: mention.notificationId,
      });
      if (!notification || notification.read) return;
    } else if (inAppNotified) {
      return;
    }

    if (!(await this.mentionRepository.claimEmailSend(mentionId))) return;

    const dashboardUrl = this.configService.get<string>('DASHBOARD_URL', '');
    const limpo = content.trim();
    const previa =
      limpo.length > TAMANHO_PREVIA
        ? `${limpo.slice(0, TAMANHO_PREVIA)}…`
        : limpo;

    try {
      await this.mailService.sendGenericNotification(
        destinatario.email,
        `${authorName} mencionou você em uma solicitação`,
        {
          userName: destinatario.name,
          title: `${authorName} mencionou você`,
          context: await this.descreverSolicitacao(surgeryRequestId),
          message: `"${previa}"`,
          link: `${dashboardUrl}/solicitacao/${surgeryRequestId}?sidebar=atividades`,
          linkText: 'Abrir solicitação',
          preferencesUrl: `${dashboardUrl}/configuracoes`,
        },
      );
    } catch (err) {
      await this.mentionRepository.releaseEmailSend(mentionId);
      throw err;
    }

    this.logger.log(`[MENCAO] E-mail da menção ${mentionId} enviado.`);
  }

  private async descreverSolicitacao(
    surgeryRequestId: string,
  ): Promise<string | undefined> {
    try {
      const solicitacao = await this.surgeryRequestRepository.findOneMinimal({
        id: surgeryRequestId,
      });
      if (!solicitacao) return undefined;

      const partes = [
        solicitacao.protocol
          ? `Solicitação ${solicitacao.protocol}`
          : 'Solicitação',
        solicitacao.patient?.name?.trim(),
        solicitacao.procedure?.name?.trim(),
      ].filter((parte): parte is string => Boolean(parte));

      return partes.join(' · ');
    } catch (err: any) {
      this.logger.warn(
        `[MENCAO] Não consegui identificar a SC ${surgeryRequestId} para o e-mail: ${err?.message}`,
      );
      return undefined;
    }
  }
}
