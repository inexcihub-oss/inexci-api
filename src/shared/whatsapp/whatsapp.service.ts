import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bull';
import { WHATSAPP_TEMPLATES } from './whatsapp-templates.constants';
import { getRequestContext } from '../logging/request-context';
import { maskPhone } from '../utils';

export interface WhatsappJobData {
  to: string;
  /** Mensagem freeform — usado apenas dentro da janela de 24h de conversa iniciada pelo usuário */
  body?: string;
  /** contentSid do template pré-aprovado pela Meta via Twilio Content API */
  contentSid?: string;
  /** Variáveis do template com chaves numéricas: {"1": valor1, "2": valor2} */
  variables?: Record<string, string>;
  /** Correlation ID propagado para o processor (logging end-to-end). */
  requestId?: string;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    @InjectQueue('whatsapp-messages')
    private readonly whatsappQueue: Queue,
  ) {}

  /**
   * Enfileira uma mensagem WhatsApp freeform para envio assíncrono via Bull queue.
   * Só funciona dentro da janela de 24h de uma conversa iniciada pelo usuário.
   */
  async sendMessage(to: string, body: string): Promise<void> {
    const requestId = getRequestContext()?.requestId;
    const masked = maskPhone(to);
    try {
      await this.whatsappQueue.add(
        'send-whatsapp',
        { to, body, requestId } satisfies WhatsappJobData,
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(`Mensagem WhatsApp enfileirada para ${masked}`);
    } catch (err: any) {
      this.logger.warn(
        `Falha ao enfileirar mensagem WhatsApp (Redis offline?): to=${masked} — ${err?.message}`,
      );
    }
  }

  /**
   * Enfileira um template WhatsApp pré-aprovado para envio assíncrono via Bull.
   * Deve ser usado para mensagens proativas (fora da janela de 24h).
   */
  async sendTemplate(
    to: string,
    contentSid: string,
    variables: Record<string, string>,
  ): Promise<void> {
    const requestId = getRequestContext()?.requestId;
    const masked = maskPhone(to);
    try {
      await this.whatsappQueue.add(
        'send-whatsapp',
        { to, contentSid, variables, requestId } satisfies WhatsappJobData,
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(
        `Template WhatsApp enfileirado para ${masked} (contentSid: ${contentSid})`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Falha ao enfileirar template WhatsApp: to=${masked} contentSid="${contentSid}" — ${err?.message}`,
      );
    }
  }

  /** Envia boas-vindas ao paciente recém-cadastrado via template aprovado pela Meta. */
  sendPatientWelcome(to: string, patientName: string): Promise<void> {
    return this.sendTemplate(to, WHATSAPP_TEMPLATES.WELCOME_PATIENT, {
      '1': patientName,
    });
  }

  /** Envia boas-vindas ao usuário (médico/colaborador) recém-cadastrado via template aprovado pela Meta. */
  sendUserWelcome(to: string, userName: string): Promise<void> {
    return this.sendTemplate(to, WHATSAPP_TEMPLATES.WELCOME_USER, {
      '1': userName,
    });
  }
}
