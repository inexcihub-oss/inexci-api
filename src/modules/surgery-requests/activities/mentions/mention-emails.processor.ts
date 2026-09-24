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

/** Trecho do comentário que vai no corpo do e-mail. */
const TAMANHO_PREVIA = 240;

/**
 * Decide, N minutos depois da menção, se o e-mail ainda faz sentido.
 *
 * Três portas, nesta ordem: já enviado (o job pode reprocessar), o usuário
 * desligou o canal, e — a regra que o usuário pediu — a notificação dentro
 * da plataforma continua não lida. Sem notificação criada no disparo (push
 * desligado) não há o que ler, e aí o e-mail é o único aviso possível:
 * mandamos. Já a notificação que existiu e sumiu foi excluída pelo usuário —
 * ele a viu, então conta como lida.
 *
 * O envio é reservado no banco (`claimEmailSend`) antes de ir para a fila
 * de e-mail: um retry do job depois do envio encontra a reserva e para.
 */
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
      // Sem a linha: excluída entre a leitura da menção e esta consulta.
      if (!notification || notification.read) return;
    } else if (inAppNotified) {
      // A FK é ON DELETE SET NULL: a notificação existiu e foi excluída.
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
        // Assunto sem nome de paciente, de propósito: nenhum dos e-mails da
        // plataforma identifica paciente no assunto, que vaza para prévia de
        // notificação e lista da caixa de entrada. A identificação da SC vai no
        // corpo, onde os outros templates já a colocam.
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

  /**
   * Linha que diz de qual solicitação a menção veio.
   *
   * Lida aqui, na hora do envio, e não capturada no job: entre a menção e o
   * e-mail passam minutos, e o que vale é o estado atual da SC.
   *
   * Nunca lança nem impede o envio — identificar a SC é um ganho de
   * contexto, enquanto o e-mail em si é o último aviso de uma menção que
   * ninguém leu na plataforma.
   */
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
