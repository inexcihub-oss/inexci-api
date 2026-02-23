import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bull';
import { MailTemplateName } from 'src/config/mail.config';

export interface MailJobData {
  template: MailTemplateName;
  to: string;
  subject: string;
  context: Record<string, any>;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@InjectQueue('mail') private readonly mailQueue: Queue) {}

  /**
   * Enfileira um e-mail para envio assíncrono.
   */
  async send(
    template: MailTemplateName,
    to: string,
    subject: string,
    context: Record<string, any>,
  ): Promise<void> {
    try {
      await this.mailQueue.add(
        'send-mail',
        { template, to, subject, context } satisfies MailJobData,
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(`E-mail enfileirado: template="${template}" to="${to}"`);
    } catch (err: any) {
      // Redis indisponível — loga aviso mas não quebra o fluxo principal
      this.logger.warn(
        `Falha ao enfileirar e-mail (Redis offline?): template="${template}" to="${to}" — ${err?.message}`,
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
}
