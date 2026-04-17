import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bull';
import { MailTemplateName } from 'src/config/mail.config';

export interface MailJobData {
  template?: MailTemplateName;
  /** HTML bruto — usado quando não há template Handlebars disponível */
  html?: string;
  to: string;
  subject: string;
  context?: Record<string, any>;
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
  ): Promise<void> {
    await this.enqueue({ template, to, subject, context });
  }

  /**
   * Enfileira um e-mail com HTML arbitrário (sem template Handlebars).
   */
  async sendRaw(to: string, subject: string, html: string): Promise<void> {
    await this.enqueue({ html, to, subject });
  }

  private async enqueue(data: MailJobData): Promise<void> {
    try {
      await this.mailQueue.add('send-mail', data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      });
      this.logger.log(
        `E-mail enfileirado: ${data.template ? `template="${data.template}"` : '(raw html)'} to="${data.to}"`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Falha ao enfileirar e-mail (Redis offline?): to="${data.to}" — ${err?.message}`,
      );
    }
  }

  /**
   * Solicitação enviada ao convênio.
   */
  async sendSurgeryRequestSent(
    to: string,
    context: {
      patientName: string;
      requestId: string;
      hospitalName: string;
      healthPlanName: string;
      doctorName: string;
    },
  ) {
    return this.send(
      'surgery-request-sent',
      to,
      'Solicitação Cirúrgica Enviada',
      context,
    );
  }

  /**
   * Autorização recebida do convênio.
   */
  async sendSurgeryAuthorized(
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
  async sendSurgeryContested(
    to: string,
    subject: string,
    context: {
      patientName: string;
      requestId: string;
      reason: string;
      message?: string;
    },
  ) {
    return this.send('surgery-contested', to, subject, context);
  }

  /**
   * Cirurgia agendada.
   */
  async sendSurgeryScheduled(
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
  async sendInvoiceSent(
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
  async sendPaymentReceived(
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
  async sendPaymentContested(
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

  /**
   * Notificação de atualização de status ao paciente.
   */
  async sendStatusUpdate(
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
      'status-update',
      to,
      'Atualização de Status da Solicitação',
      context,
    );
  }

  async sendStatusChangeStakeholder(
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
   */
  async sendStatusChangePatient(
    to: string,
    context: {
      patientName: string;
      requestId: string;
      oldStatus: string;
      newStatus: string;
      changedAt: string;
      preferencesUrl?: string;
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
  async sendStaleReminder(
    to: string,
    context: {
      patientName: string;
      requestId: string;
      currentStatus: string;
      staleDays: number;
      lastMovedAt: string;
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
  async sendStaleCritical(
    to: string,
    context: {
      patientName: string;
      requestId: string;
      currentStatus: string;
      staleDays: number;
      lastMovedAt: string;
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
  async sendActionAdminAlert(
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
   */
  async sendWelcomePatient(
    to: string,
    context: {
      patientName: string;
      doctorName: string;
      hospitalName?: string;
      dashboardUrl?: string;
      preferencesUrl?: string;
    },
  ) {
    return this.send('welcome-patient', to, 'Bem-vindo ao Inexci!', context);
  }

  /**
   * Boas-vindas ao médico.
   */
  async sendWelcomeDoctor(
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
}
