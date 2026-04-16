import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { MailService } from 'src/shared/mail/mail.service';
import { getStatusLabel } from 'src/shared/utils';

@Injectable()
export class SurgeryRequestNotificationService {
  private readonly logger = new Logger(SurgeryRequestNotificationService.name);

  private readonly STATUS_TEMPLATE_MAP: Record<number, string[]> = {
    [SurgeryRequestStatus.SENT]: ['surgery-request-sent'],
    [SurgeryRequestStatus.IN_SCHEDULING]: ['surgery-authorized'],
    [SurgeryRequestStatus.IN_ANALYSIS]: ['surgery-contested'],
    [SurgeryRequestStatus.SCHEDULED]: ['surgery-scheduled'],
    [SurgeryRequestStatus.INVOICED]: ['invoice-sent'],
    [SurgeryRequestStatus.FINALIZED]: ['payment-received', 'payment-contested'],
  };

  constructor(
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly mailService: MailService,
  ) {}

  /**
   * Envia e-mail de atualização de status ao paciente, se solicitado.
   * Não bloqueia nem lança exceção em caso de falha.
   */
  async notifyPatientIfRequested(
    request: any,
    prevStatus: SurgeryRequestStatus,
    newStatus: SurgeryRequestStatus,
    notifyPatient?: boolean,
  ): Promise<void> {
    if (!notifyPatient) return;

    const patientEmail = request.patient?.email;
    if (!patientEmail) {
      this.logger.warn(
        `notify_patient solicitado mas paciente sem e-mail (solicitação ${request.id})`,
      );
      return;
    }

    const patientName = request.patient?.name ?? 'Paciente';
    const requestId = request.protocol ?? request.id;
    const oldLabel = getStatusLabel(prevStatus);
    const newLabel = getStatusLabel(newStatus);
    const changedAt = new Date().toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    try {
      await this.mailService.sendStatusUpdate(patientEmail, {
        patientName,
        requestId,
        oldStatus: oldLabel,
        newStatus: newLabel,
        changedAt,
      });
    } catch (err: any) {
      this.logger.warn(`Falha ao notificar paciente: ${err?.message}`);
    }
  }

  /**
   * Envia e-mail com template específico conforme o status atual da solicitação.
   */
  async notify(
    id: string,
    dto: { template: string; to?: string },
    userId: string,
  ) {
    const request =
      await this.surgeryRequestRepository.findOneWithRelations({ id }, [
        'created_by',
        'patient',
        'hospital',
        'health_plan',
        'tuss_items',
        'billing',
      ]);
    if (!request) throw new NotFoundException('Solicitação não encontrada');

    const allowed = this.STATUS_TEMPLATE_MAP[request.status] ?? [];
    if (!allowed.includes(dto.template)) {
      throw new BadRequestException(
        `O template "${dto.template}" não é compatível com o status atual da solicitação.`,
      );
    }

    const to = dto.to ?? request.created_by?.email;
    if (!to) {
      throw new BadRequestException('Destinatário de e-mail não encontrado.');
    }

    const patientName = request.patient?.name ?? 'Paciente';
    const requestId = request.protocol ?? id;
    const doctorName = request.created_by?.name ?? 'Médico';
    const healthPlanName = request.health_plan?.name ?? '';
    const hospitalName = request.hospital?.name ?? '';

    switch (dto.template) {
      case 'surgery-request-sent':
        await this.mailService.sendSurgeryRequestSent(to, {
          patientName,
          requestId,
          hospitalName,
          healthPlanName,
          doctorName,
        });
        break;
      case 'surgery-authorized':
        await this.mailService.sendSurgeryAuthorized(to, {
          patientName,
          requestId,
          authorizedProcedures: (request.tuss_items ?? [])
            .filter((p) => p.authorized_quantity)
            .map((p) => p.name),
        });
        break;
      case 'surgery-contested':
        await this.mailService.sendSurgeryContested(
          to,
          'Contestação de Autorização — Inexci',
          {
            patientName,
            requestId,
            reason: 'Ver detalhes no sistema Inexci.',
          },
        );
        break;
      case 'surgery-scheduled':
        await this.mailService.sendSurgeryScheduled(to, {
          patientName,
          requestId,
          surgeryDate: request.surgery_date
            ? new Date(request.surgery_date).toLocaleDateString('pt-BR')
            : '—',
          hospitalName,
        });
        break;
      case 'invoice-sent':
        if (!request.billing)
          throw new BadRequestException('Sem dados de faturamento.');
        await this.mailService.sendInvoiceSent(to, {
          patientName,
          requestId,
          invoiceProtocol: request.billing.invoice_protocol,
          invoiceValue: `R$ ${Number(request.billing.invoice_value).toFixed(2).replace('.', ',')}`,
          paymentDeadline: request.billing.payment_deadline
            ? new Date(request.billing.payment_deadline).toLocaleDateString(
                'pt-BR',
              )
            : undefined,
        });
        break;
      case 'payment-received':
        if (!request.billing)
          throw new BadRequestException('Sem dados de faturamento.');
        await this.mailService.sendPaymentReceived(to, {
          patientName,
          requestId,
          receivedValue: `R$ ${Number(request.billing.received_value).toFixed(2).replace('.', ',')}`,
          receivedAt: request.billing.received_at
            ? new Date(request.billing.received_at).toLocaleDateString('pt-BR')
            : '—',
        });
        break;
      case 'payment-contested':
        if (!request.billing)
          throw new BadRequestException('Sem dados de faturamento.');
        await this.mailService.sendPaymentContested(
          to,
          'Contestação de Pagamento — Inexci',
          {
            patientName,
            requestId,
            invoiceValue: `R$ ${Number(request.billing.invoice_value).toFixed(2).replace('.', ',')}`,
            receivedValue: `R$ ${Number(
              request.billing.contested_received_value ??
                request.billing.received_value,
            )
              .toFixed(2)
              .replace('.', ',')}`,
            message: 'Ver detalhes no sistema Inexci.',
          },
        );
        break;
    }

    return { notified: true, template: dto.template, to };
  }
}
