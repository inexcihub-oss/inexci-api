import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bull';
import { WHATSAPP_TEMPLATES } from './whatsapp-templates.constants';
import { getRequestContext } from '../logging/request-context';
import { maskPhone } from '../utils';

export interface WhatsappJobData {
  to: string;
  body?: string;
  contentSid?: string;
  variables?: Record<string, string>;
  requestId?: string;
  userId?: string | null;
  tenantId?: string | null;
}

export interface DadosDaConsulta {
  patientName: string;
  doctorName: string;
  when: string;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    @InjectQueue('whatsapp-messages')
    private readonly whatsappQueue: Queue,
  ) {}

  async sendMessage(to: string, body: string): Promise<void> {
    const ctx = getRequestContext();
    const masked = maskPhone(to);
    try {
      await this.whatsappQueue.add(
        'send-whatsapp',
        {
          to,
          body,
          requestId: ctx?.requestId,
          userId: ctx?.userId ?? null,
          tenantId: ctx?.tenantId ?? null,
        } satisfies WhatsappJobData,
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

  async sendTemplate(
    to: string,
    contentSid: string,
    variables: Record<string, string>,
  ): Promise<void> {
    const ctx = getRequestContext();
    const masked = maskPhone(to);
    try {
      await this.whatsappQueue.add(
        'send-whatsapp',
        {
          to,
          contentSid,
          variables,
          requestId: ctx?.requestId,
          userId: ctx?.userId ?? null,
          tenantId: ctx?.tenantId ?? null,
        } satisfies WhatsappJobData,
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

  sendPatientWelcome(to: string, patientName: string): Promise<void> {
    return this.sendTemplate(to, WHATSAPP_TEMPLATES.WELCOME_PATIENT, {
      '1': patientName,
    });
  }

  sendUserWelcome(to: string, userName: string): Promise<void> {
    return this.sendTemplate(to, WHATSAPP_TEMPLATES.WELCOME_USER, {
      '1': userName,
    });
  }

  sendAppointmentConfirmation(
    to: string,
    dados: DadosDaConsulta,
  ): Promise<void> {
    return this.sendTemplate(to, WHATSAPP_TEMPLATES.APPOINTMENT_CONFIRMATION, {
      '1': dados.patientName,
      '2': dados.doctorName,
      '3': dados.when,
    });
  }

  sendAppointmentScheduled(to: string, dados: DadosDaConsulta): Promise<void> {
    return this.sendTemplate(to, WHATSAPP_TEMPLATES.APPOINTMENT_SCHEDULED, {
      '1': dados.patientName,
      '2': dados.doctorName,
      '3': dados.when,
    });
  }

  sendAppointmentCancelled(to: string, dados: DadosDaConsulta): Promise<void> {
    return this.sendTemplate(to, WHATSAPP_TEMPLATES.APPOINTMENT_CANCELLED, {
      '1': dados.patientName,
      '2': dados.when,
      '3': dados.doctorName,
    });
  }
}
