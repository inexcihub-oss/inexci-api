import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import * as Twilio from 'twilio';
import {
  NotificationSendLog,
  NotificationChannel,
  NotificationSendStatus,
  NotificationDirection,
  NotificationSendType,
} from 'src/database/entities/notification-send-log.entity';
import { WhatsappJobData } from './whatsapp.service';
import {
  truncateForLog,
  truncateErrorForLog,
  maskPhone,
} from 'src/shared/utils';
import { requestContextStorage } from 'src/shared/logging/request-context';
import { randomUUID } from 'crypto';

@Injectable()
@Processor('whatsapp-messages')
export class WhatsappProcessor {
  private readonly logger = new Logger(WhatsappProcessor.name);
  private readonly twilioClient: ReturnType<typeof Twilio> | null;
  private readonly twilioWhatsappFrom: string;

  /**
   * Normaliza um número de telefone para o formato E.164 exigido pelo Twilio.
   */
  private normalizeToE164(phone: string): string {
    const clean = phone.replace(/^whatsapp:/i, '');
    const digits = clean.replace(/\D/g, '');

    if (digits.startsWith('55') && digits.length >= 12) {
      return `+${digits}`;
    }
    return `+55${digits}`;
  }

  constructor(
    @InjectRepository(NotificationSendLog)
    private readonly sendLogRepository: Repository<NotificationSendLog>,
    private readonly configService: ConfigService,
  ) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');

    if (accountSid && authToken) {
      this.twilioClient = Twilio(accountSid, authToken);
    } else {
      this.twilioClient = null;
      this.logger.warn(
        'Twilio não configurado (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN ausentes). Mensagens WhatsApp serão apenas logadas.',
      );
    }

    this.twilioWhatsappFrom =
      this.configService.get<string>('TWILIO_WHATSAPP_FROM') ?? '';
  }

  @Process('send-whatsapp')
  async handleSendWhatsapp(job: Job<WhatsappJobData>): Promise<void> {
    const requestId = job.data.requestId || randomUUID();
    return requestContextStorage.run({ requestId }, () =>
      this.processSendWhatsapp(job),
    );
  }

  private async processSendWhatsapp(job: Job<WhatsappJobData>): Promise<void> {
    const { to, body, contentSid, variables } = job.data;
    const from = this.twilioWhatsappFrom;

    const toNormalized = this.normalizeToE164(to);
    const toFormatted = `whatsapp:${toNormalized}`;

    const fromNormalized = from.startsWith('whatsapp:')
      ? from
      : `whatsapp:${from}`;

    const isTemplate = !!contentSid;
    const logBody = isTemplate
      ? `[template:${contentSid}] vars=${JSON.stringify(variables ?? {})}`
      : (body ?? '');

    let status = NotificationSendStatus.SENT;
    let errorMessage: string | null = null;
    let sentAt: Date | null = null;
    let messageSid: string | null = null;

    const maskedTo = maskPhone(toNormalized);

    try {
      if (!this.twilioClient) {
        this.logger.log(
          `[DEV] WhatsApp (sem Twilio) → ${maskedTo}: ${truncateForLog(logBody, 120)}`,
        );
        sentAt = new Date();
      } else if (isTemplate) {
        this.logger.log(
          `Enviando template WhatsApp: to=${maskedTo} contentSid=${contentSid}`,
        );
        const result = await this.twilioClient.messages.create({
          from: fromNormalized,
          to: toFormatted,
          contentSid,
          contentVariables: JSON.stringify(variables ?? {}),
        } as any);
        sentAt = new Date();
        messageSid = result?.sid ?? null;
        this.logger.log(
          `Template WhatsApp enviado com sucesso para ${maskedTo}`,
        );
      } else {
        this.logger.log(`Enviando WhatsApp: to=${maskedTo}`);
        const result = await this.twilioClient.messages.create({
          from: fromNormalized,
          to: toFormatted,
          body,
        });
        sentAt = new Date();
        messageSid = result?.sid ?? null;
        this.logger.log(
          `Mensagem WhatsApp enviada com sucesso para ${maskedTo}`,
        );
      }
    } catch (error: any) {
      status = NotificationSendStatus.FAILED;
      errorMessage = truncateErrorForLog(error);
      this.logger.warn(
        `Falha ao enviar mensagem WhatsApp para ${maskedTo}: ${errorMessage}`,
      );
    } finally {
      try {
        const sendLog = this.sendLogRepository.create({
          channel: NotificationChannel.WHATSAPP,
          status,
          to: maskedTo,
          body: truncateForLog(logBody, 500),
          template: isTemplate ? contentSid : null,
          errorMessage: truncateForLog(errorMessage, 500),
          jobId: String(job.id),
          attempts: job.attemptsMade + 1,
          sentAt: sentAt,
          messageSid,
          direction: NotificationDirection.OUTBOUND,
          notificationType: isTemplate
            ? NotificationSendType.TEMPLATE
            : NotificationSendType.FREEFORM,
        });
        await this.sendLogRepository.save(sendLog);
      } catch (logErr: any) {
        this.logger.error(
          `Falha ao salvar notification_send_log: ${logErr?.message}`,
        );
      }
    }
  }

  @OnQueueFailed()
  handleFailedJob(job: Job<WhatsappJobData>, error: Error) {
    const maxAttempts = job.opts?.attempts ?? 3;
    if (job.attemptsMade >= maxAttempts) {
      this.logger.error(
        JSON.stringify({
          event: 'whatsapp_dead_letter',
          to: maskPhone(job.data.to),
          contentSid: job.data.contentSid ?? null,
          jobId: job.id,
          attemptsMade: job.attemptsMade,
          error: truncateForLog(error.message, 200),
        }),
      );
    }
  }
}
