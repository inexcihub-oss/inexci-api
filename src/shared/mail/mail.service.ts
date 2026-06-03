import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bull';
import { MailTemplateName } from 'src/config/mail.config';
import { getRequestContext } from 'src/shared/logging/request-context';
import { maskEmail } from 'src/shared/utils';

export interface MailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface MailJobData {
  template?: MailTemplateName;
  /** HTML bruto — usado quando não há template Handlebars disponível */
  html?: string;
  to: string;
  cc?: string;
  subject: string;
  context?: Record<string, any>;
  attachments?: MailAttachment[];
  /** Correlation ID propagado para o processor (logging end-to-end). */
  requestId?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@InjectQueue('mail') private readonly mailQueue: Queue) {}

  /**
   * Enfileira um e-mail para envio assíncrono usando template Handlebars.
   */
  async send(
    template: MailTemplateName,
    to: string,
    subject: string,
    context: Record<string, any>,
    attachments?: MailAttachment[],
    cc?: string,
  ): Promise<void> {
    await this.enqueue({ template, to, subject, context, attachments, cc });
  }

  /**
   * Enfileira um e-mail com HTML arbitrário (sem template Handlebars).
   */
  async sendRaw(to: string, subject: string, html: string): Promise<void> {
    await this.enqueue({ html, to, subject });
  }

  private async enqueue(data: MailJobData): Promise<void> {
    const requestId = getRequestContext()?.requestId;
    const masked = maskEmail(data.to);
    try {
      await this.mailQueue.add(
        'send-mail',
        { ...data, requestId },
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
    } catch (err: any) {
      this.logger.warn(
        `Falha ao enfileirar e-mail (Redis offline?): to=${masked} — ${err?.message}`,
      );
    }
  }

  /**
   * Solicitação enviada ao convênio.
   */
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
      'Solicitação Cirúrgica Enviada',
      context,
      attachments,
      cc,
    );
  }

  /**
   * Autorização recebida do convênio.
   */
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

  /**
   * Contestação de autorização enviada.
   */
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
  ) {
    return this.send('surgery-contested', to, subject, context, attachments);
  }

  /**
   * Cirurgia agendada.
   */
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

  /**
   * Fatura enviada ao convênio.
   */
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

  /**
   * Pagamento recebido confirmado.
   */
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

  /**
   * Contestação de pagamento enviada.
   */
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

  sendStatusChangeStakeholder(
    to: string,
    context: {
      patientName: string;
      oldStatus: string;
      newStatus: string;
      changedBy: string;
      changedAt: string;
      dashboardUrl?: string;
    },
  ) {
    return this.send(
      'status-change-stakeholder',
      to,
      'Status da Solicitação Atualizado',
      context,
    );
  }

  /**
   * Notificação de mudança de status ao paciente (usa layout unificado).
   * Paciente não tem acesso ao dashboard: a comunicação se concentra no WhatsApp.
   */
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

  /**
   * Lembrete de solicitação parada (stale).
   */
  sendStaleReminder(
    to: string,
    context: {
      patientName: string;
      requestId?: string;
      currentStatus: string;
      staleDays: number;
      lastMovedAt?: string;
      dashboardUrl?: string;
      preferencesUrl?: string;
    },
  ) {
    return this.send(
      'stale-reminder',
      to,
      `Solicitação parada há ${context.staleDays} dias`,
      context,
    );
  }

  /**
   * Alerta crítico de solicitação parada (15+ dias).
   */
  sendStaleCritical(
    to: string,
    context: {
      patientName: string;
      requestId?: string;
      currentStatus: string;
      staleDays: number;
      lastMovedAt?: string;
      dashboardUrl?: string;
      preferencesUrl?: string;
    },
  ) {
    return this.send(
      'stale-critical',
      to,
      `⚠️ ALERTA: Solicitação parada há ${context.staleDays} dias`,
      context,
    );
  }

  /**
   * Alerta de ação para admins.
   */
  sendActionAdminAlert(
    to: string,
    context: {
      actionLabel: string;
      actorName: string;
      patientName: string;
      requestId: string;
      actionAt: string;
      dashboardUrl?: string;
      preferencesUrl?: string;
    },
  ) {
    return this.send(
      'action-admin-alert',
      to,
      'Ação Realizada em Solicitação',
      context,
    );
  }

  /**
   * Boas-vindas ao paciente.
   * Paciente não tem acesso ao dashboard: toda a comunicação ocorre via WhatsApp.
   */
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

  /**
   * Boas-vindas ao médico.
   */
  sendWelcomeDoctor(
    to: string,
    context: {
      doctorName: string;
      email: string;
      hospitalName?: string;
      dashboardUrl?: string;
      preferencesUrl?: string;
    },
  ) {
    return this.send(
      'welcome-doctor',
      to,
      'Bem-vindo ao Inexci, Dr(a)!',
      context,
    );
  }

  /**
   * Recuperação de senha — código de verificação.
   */
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

  /**
   * Confirmação de e-mail após cadastro.
   */
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

  /**
   * Resumo semanal de solicitações cirúrgicas e pendências.
   */
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

  /**
   * Notificação genérica (in-app com e-mail).
   */
  sendGenericNotification(
    to: string,
    subject: string,
    context: {
      userName?: string;
      title?: string;
      message: string;
      link?: string;
      linkText?: string;
      preferencesUrl?: string;
    },
  ) {
    return this.send('generic-notification', to, subject, context);
  }
}
