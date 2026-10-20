import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bull';
import { MailTemplateName } from 'src/config/mail.config';
import { getRequestContext } from 'src/shared/logging/request-context';
import { maskEmail } from 'src/shared/utils';
import { errorMessage } from 'src/shared/utils/error-message.util';

export interface MailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface MailJobData {
  template?: MailTemplateName;
  html?: string;
  to: string;
  cc?: string;
  subject: string;
  context?: Record<string, unknown>;
  attachments?: MailAttachment[];
  requestId?: string;
  userId?: string | null;
  tenantId?: string | null;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@InjectQueue('mail') private readonly mailQueue: Queue) {}

  async send(
    template: MailTemplateName,
    to: string,
    subject: string,
    context: Record<string, unknown>,
    attachments?: MailAttachment[],
    cc?: string,
  ): Promise<void> {
    await this.enqueue({ template, to, subject, context, attachments, cc });
  }

  private async enqueue(data: MailJobData): Promise<void> {
    const ctx = getRequestContext();
    const masked = maskEmail(data.to);
    try {
      await this.mailQueue.add(
        'send-mail',
        {
          ...data,
          requestId: ctx?.requestId,
          userId: ctx?.userId ?? null,
          tenantId: ctx?.tenantId ?? null,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(
        `E-mail enfileirado: ${data.template ? `template="${data.template}"` : '(raw html)'} to=${masked}`,
      );
    } catch (err) {
      this.logger.warn(
        `Falha ao enfileirar e-mail (Redis offline?): to=${masked} — ${errorMessage(err)}`,
      );
    }
  }

  sendSurgeryRequestSent(
    to: string,
    context: {
      patientName: string;
      requestId: string;
      hospitalName: string;
      healthPlanName: string;
      doctorName: string;
    },
    attachments?: MailAttachment[],
    cc?: string,
  ) {
    return this.send(
      'surgery-request-sent',
      to,
      'Solicitação Cirúrgica — Análise e Autorização',
      context,
      attachments,
      cc,
    );
  }

  sendSurgeryAuthorized(
    to: string,
    context: {
      patientName: string;
      requestId: string;
      authorizedProcedures: string[];
    },
  ) {
    return this.send('surgery-authorized', to, 'Autorização Recebida', context);
  }

  sendSurgeryContested(
    to: string,
    subject: string,
    context: {
      patientName: string;
      requestId: string;
      reason: string;
      message?: string;
    },
    attachments?: MailAttachment[],
    cc?: string,
  ) {
    return this.send(
      'surgery-contested',
      to,
      subject,
      context,
      attachments,
      cc,
    );
  }

  sendSurgeryScheduled(
    to: string,
    context: {
      patientName: string;
      requestId: string;
      surgeryDate: string;
      hospitalName: string;
    },
  ) {
    return this.send('surgery-scheduled', to, 'Cirurgia Agendada', context);
  }

  sendInvoiceSent(
    to: string,
    context: {
      patientName: string;
      requestId: string;
      invoiceProtocol: string;
      invoiceValue: string;
      paymentDeadline?: string;
    },
  ) {
    return this.send('invoice-sent', to, 'Fatura Enviada ao Convênio', context);
  }

  sendPaymentReceived(
    to: string,
    context: {
      patientName: string;
      requestId: string;
      receivedValue: string;
      receivedAt: string;
    },
  ) {
    return this.send(
      'payment-received',
      to,
      'Pagamento Recebido Confirmado',
      context,
    );
  }

  sendPaymentContested(
    to: string,
    subject: string,
    context: {
      patientName: string;
      requestId: string;
      invoiceValue: string;
      receivedValue: string;
      message: string;
    },
  ) {
    return this.send('payment-contested', to, subject, context);
  }

  sendStatusChangePatient(
    to: string,
    context: {
      patientName: string;
      requestId: string;
      oldStatus: string;
      newStatus: string;
      changedAt: string;
    },
  ) {
    return this.send(
      'status-change-patient',
      to,
      'Atualização da sua Solicitação Cirúrgica',
      context,
    );
  }

  sendWelcomePatient(
    to: string,
    context: {
      patientName: string;
      doctorName: string;
      hospitalName?: string;
    },
  ) {
    return this.send('welcome-patient', to, 'Bem-vindo ao Inexci!', context);
  }

  sendPasswordRecovery(
    to: string,
    context: { userName: string; validationCode: string },
  ) {
    return this.send(
      'password-recovery',
      to,
      'Inexci — Recuperação de Senha',
      context,
    );
  }

  sendEmailVerification(
    to: string,
    context: {
      userName: string;
      email: string;
      verificationUrl: string;
    },
  ) {
    return this.send(
      'email-verification',
      to,
      'Inexci — Confirme seu e-mail',
      context,
    );
  }

  sendWeeklySummary(
    to: string,
    context: {
      userName: string;
      periodStart: string;
      periodEnd: string;
      counts: {
        created: number;
        statusChanged: number;
        finalized: number;
        withPendingBlocking: number;
      };
      highlights: Array<{
        protocol: string;
        patientName: string;
        statusLabel: string;
        pendingLabel?: string;
      }>;
      dashboardUrl?: string;
      preferencesUrl?: string;
    },
  ) {
    return this.send(
      'weekly-summary',
      to,
      `Resumo semanal — ${context.periodStart} a ${context.periodEnd}`,
      context,
    );
  }

  sendAppointmentReminder(
    to: string,
    context: {
      patientName: string;
      doctorName?: string;
      when: string;
      typeLabel?: string;
      durationLabel?: string;
    },
  ) {
    return this.send(
      'appointment-reminder',
      to,
      'Lembrete de consulta',
      context,
    );
  }

  sendGenericNotification(
    to: string,
    subject: string,
    context: {
      userName?: string;
      title?: string;
      message: string;
      context?: string;
      link?: string;
      linkText?: string;
      preferencesUrl?: string;
    },
  ) {
    return this.send('generic-notification', to, subject, context);
  }
}
