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

    this.twilioWhatsappFrom = this.configService.get<string>(
      'TWILIO_WHATSAPP_FROM',
    );
  }

  @Process('send-whatsapp')
  async handleSendWhatsapp(job: Job<WhatsappJobData>): Promise<void> {
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

    try {
      if (!this.twilioClient) {
        this.logger.log(
          `[DEV] WhatsApp (sem Twilio) → ${toFormatted}: ${logBody}`,
        );
        sentAt = new Date();
      } else if (isTemplate) {
        this.logger.log(
          `Enviando template WhatsApp: from=${fromNormalized} to=${toFormatted} contentSid=${contentSid}`,
        );
        const result = await this.twilioClient.messages.create({
          from: fromNormalized,
          to: toFormatted,
          contentSid,
          contentVariables: JSON.stringify(variables ?? {}),
        } as any);
        sentAt = new Date();
        messageSid = result?.sid ?? null;
        this.logger.log(`Template WhatsApp enviado com sucesso para: ${to}`);
      } else {
        this.logger.log(
          `Enviando WhatsApp: from=${fromNormalized} to=${toFormatted}`,
        );
        const result = await this.twilioClient.messages.create({
          from: fromNormalized,
          to: toFormatted,
          body,
        });
        sentAt = new Date();
        messageSid = result?.sid ?? null;
        this.logger.log(`Mensagem WhatsApp enviada com sucesso para: ${to}`);
      }
    } catch (error: any) {
      status = NotificationSendStatus.FAILED;
      errorMessage = error?.message ?? String(error);
      this.logger.warn(
        `Falha ao enviar mensagem WhatsApp para ${to}: ${errorMessage}`,
      );
    } finally {
      try {
        const sendLog = this.sendLogRepository.create({
          channel: NotificationChannel.WHATSAPP,
          status,
          to: toNormalized,
          body: logBody,
          template: isTemplate ? contentSid : null,
          error_message: errorMessage,
          job_id: String(job.id),
          attempts: job.attemptsMade + 1,
          sent_at: sentAt,
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
          to: job.data.to,
          contentSid: job.data.contentSid ?? null,
          jobId: job.id,
          attemptsMade: job.attemptsMade,
          error: error.message,
        }),
      );
    }
  }
}
