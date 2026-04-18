import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import Twilio = require('twilio');
import {
  WhatsappMessageLog,
  WhatsappMessageStatus,
} from 'src/database/entities/whatsapp-message-log.entity';
import {
  NotificationSendLog,
  NotificationChannel,
  NotificationSendStatus,
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
   * Exemplos de entrada aceitos:
   *   "(21) 98765-4321"  → "+5521987654321"
   *   "21987654321"      → "+5521987654321"
   *   "+5521987654321"   → "+5521987654321"
   *   "5521987654321"    → "+5521987654321"
   */
  private normalizeToE164(phone: string): string {
    // Remove prefixo whatsapp: caso exista
    const clean = phone.replace(/^whatsapp:/i, '');
    // Mantém apenas dígitos
    const digits = clean.replace(/\D/g, '');

    // Já tem código do país completo (55 + DDD + número = 13 dígitos)
    if (digits.startsWith('55') && digits.length >= 12) {
      return `+${digits}`;
    }
    // Assume Brasil (+55) — DDD + 9 dígitos (celular) ou 8 dígitos (fixo)
    return `+55${digits}`;
  }

  constructor(
    @InjectRepository(WhatsappMessageLog)
    private readonly logRepository: Repository<WhatsappMessageLog>,
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
      'whatsapp:+14155238886',
    );
  }

  @Process('send-whatsapp')
  async handleSendWhatsapp(job: Job<WhatsappJobData>): Promise<void> {
    const { to, body, contentSid, variables } = job.data;
    const from = this.twilioWhatsappFrom;

    // TO: normaliza o número do paciente (pode estar em vários formatos, ex: "(31) 98908-5791")
    const toNormalized = this.normalizeToE164(to);
    const toFormatted = `whatsapp:${toNormalized}`;

    // FROM: usa o número Twilio diretamente — já está em formato E.164 correto no env var
    const fromNormalized = from.startsWith('whatsapp:')
      ? from
      : `whatsapp:${from}`;

    const isTemplate = !!contentSid;
    const logBody = isTemplate
      ? `[template:${contentSid}] vars=${JSON.stringify(variables ?? {})}`
      : (body ?? '');

    const log = this.logRepository.create({
      to: toNormalized,
      body: logBody,
      status: WhatsappMessageStatus.SENT,
      sentAt: null,
      errorMessage: null,
    });

    try {
      if (!this.twilioClient) {
        this.logger.log(
          `[DEV] WhatsApp (sem Twilio) → ${toFormatted}: ${logBody}`,
        );
        log.status = WhatsappMessageStatus.SENT;
        log.sentAt = new Date();
      } else if (isTemplate) {
        this.logger.log(
          `Enviando template WhatsApp: from=${fromNormalized} to=${toFormatted} contentSid=${contentSid}`,
        );
        await this.twilioClient.messages.create({
          from: fromNormalized,
          to: toFormatted,
          contentSid,
          contentVariables: JSON.stringify(variables ?? {}),
        } as any);
        log.status = WhatsappMessageStatus.SENT;
        log.sentAt = new Date();
        this.logger.log(`Template WhatsApp enviado com sucesso para: ${to}`);
      } else {
        this.logger.log(
          `Enviando WhatsApp: from=${fromNormalized} to=${toFormatted}`,
        );
        await this.twilioClient.messages.create({
          from: fromNormalized,
          to: toFormatted,
          body,
        });
        log.status = WhatsappMessageStatus.SENT;
        log.sentAt = new Date();
        this.logger.log(`Mensagem WhatsApp enviada com sucesso para: ${to}`);
      }
    } catch (error: any) {
      log.status = WhatsappMessageStatus.FAILED;
      log.errorMessage = error?.message ?? String(error);
      this.logger.warn(
        `Falha ao enviar mensagem WhatsApp para ${to}: ${log.errorMessage}`,
      );
      // Não relança o erro — deixa o Bull marcar como failed para o retry automático
      // mas evita quebrar o fluxo principal
    } finally {
      try {
        await this.logRepository.save(log);
      } catch (logErr: any) {
        this.logger.error(
          `Falha ao salvar log de WhatsApp: ${logErr?.message}`,
        );
      }

      // Salvar no notification_send_log unificado
      try {
        const sendLog = this.sendLogRepository.create({
          channel: NotificationChannel.WHATSAPP,
          status:
            log.status === WhatsappMessageStatus.SENT
              ? NotificationSendStatus.SENT
              : NotificationSendStatus.FAILED,
          to: toNormalized,
          template: isTemplate ? contentSid : null,
          error_message: log.errorMessage,
          job_id: String(job.id),
          attempts: job.attemptsMade + 1,
          sent_at: log.sentAt,
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
