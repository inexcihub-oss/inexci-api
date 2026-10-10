import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { MailService } from 'src/shared/mail/mail.service';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import {
  PatientNotificationService,
  type PatientNotificationContext,
  type PatientSchedulingNotificationContext,
} from 'src/modules/notifications/patient-notification.service';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';
import { SchedulingSelectionStore } from './workflow/scheduling-selection.store';

@Injectable()
export class SurgeryRequestNotificationService {
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
    private readonly notificationsService: NotificationsService,
    private readonly patientNotificationService: PatientNotificationService,
    private readonly schedulingSelectionStore: SchedulingSelectionStore,
  ) {}

  async notifyPatientIfRequested(
    request: PatientNotificationContext['request'],
    prevStatus: SurgeryRequestStatus,
    newStatus: SurgeryRequestStatus,
    notifyPatient?: boolean,
  ): Promise<void> {
    if (notifyPatient !== true) return;

    await this.patientNotificationService.notifyPatientStatusChange({
      request,
      oldStatus: prevStatus,
      newStatus,
      notifyPatient: true,
    });
  }

  async notifyPatientSchedulingOptions(
    request: PatientSchedulingNotificationContext['request'],
    dateOptions: string[],
  ): Promise<void> {
    await this.patientNotificationService.notifyPatientSchedulingOptions({
      request,
      dateOptions,
    });

    const patientPhone = request.patient?.phone;
    if (patientPhone) {
      await this.schedulingSelectionStore.remember(patientPhone, request.id);
    }
  }

  async notify(
    id: string,
    dto: {
      template: string;
      to?: string;
      channels?: { email?: boolean; whatsapp?: boolean };
      oldStatus?: number;
    },
    _userId: string,
  ) {
    const request = await this.surgeryRequestRepository.findOneWithRelations(
      { id },
      [
        'createdBy',
        'patient',
        'hospital',
        'healthPlan',
        'tussItems',
        'billing',
      ],
    );
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);

    if (dto.template === 'status-change-patient') {
      const previousStatus =
        (dto.oldStatus as SurgeryRequestStatus | undefined) ??
        (await this.surgeryRequestRepository.findPreviousStatus(id)) ??
        request.status;

      await this.patientNotificationService.notifyPatientStatusChange({
        request,
        oldStatus: previousStatus,
        newStatus: request.status,
        notifyPatient: true,
        channels: dto.channels,
      });
      return { notified: true, template: dto.template, channels: dto.channels };
    }

    const allowed = this.STATUS_TEMPLATE_MAP[request.status] ?? [];
    if (!allowed.includes(dto.template)) {
      throw new BadRequestException(
        `O template "${dto.template}" não é compatível com o status atual da solicitação.`,
      );
    }

    const to = dto.to ?? request.createdBy?.email;
    if (!to) {
      throw new BadRequestException('Destinatário de e-mail não encontrado.');
    }

    const patientName = request.patient?.name ?? 'Paciente';
    const requestId = request.protocol ?? id;
    const doctorName = request.createdBy?.name ?? 'Médico';
    const healthPlanName = request.healthPlan?.name ?? '';
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
          authorizedProcedures: (request.tussItems ?? [])
            .filter((p) => p.authorizedQuantity)
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
          surgeryDate: request.surgeryDate
            ? new Date(request.surgeryDate).toLocaleDateString('pt-BR')
            : '—',
          hospitalName,
        });
        break;
      case 'invoice-sent':
        if (!request.billing)
          throw new BadRequestException(ERROR_MESSAGES.NO_BILLING_DATA);
        await this.mailService.sendInvoiceSent(to, {
          patientName,
          requestId,
          invoiceProtocol: request.billing.invoiceProtocol,
          invoiceValue: `R$ ${Number(request.billing.invoiceValue).toFixed(2).replace('.', ',')}`,
          paymentDeadline: request.billing.paymentDeadline
            ? new Date(request.billing.paymentDeadline).toLocaleDateString(
                'pt-BR',
              )
            : undefined,
        });
        break;
      case 'payment-received':
        if (!request.billing)
          throw new BadRequestException(ERROR_MESSAGES.NO_BILLING_DATA);
        await this.mailService.sendPaymentReceived(to, {
          patientName,
          requestId,
          receivedValue: `R$ ${Number(request.billing.receivedValue).toFixed(2).replace('.', ',')}`,
          receivedAt: request.billing.receivedAt
            ? new Date(request.billing.receivedAt).toLocaleDateString('pt-BR')
            : '—',
        });
        break;
      case 'payment-contested':
        if (!request.billing)
          throw new BadRequestException(ERROR_MESSAGES.NO_BILLING_DATA);
        await this.mailService.sendPaymentContested(
          to,
          'Contestação de Pagamento — Inexci',
          {
            patientName,
            requestId,
            invoiceValue: `R$ ${Number(request.billing.invoiceValue).toFixed(2).replace('.', ',')}`,
            receivedValue: `R$ ${Number(
              request.billing.contestedReceivedValue ??
                request.billing.receivedValue,
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

  async notifyStakeholdersOfStatusChange(
    request: {
      id: string;
      doctorId: string;
      createdById: string;
    },
    oldStatus: SurgeryRequestStatus,
    newStatus: SurgeryRequestStatus,
    actorId: string,
    options?: { sendWhatsapp?: boolean },
  ): Promise<void> {
    await this.notificationsService.notifyStatusChange(
      request.id,
      request.doctorId,
      request.createdById,
      oldStatus,
      newStatus,
      actorId,
      options,
    );
  }

  async notifyAdminsOfWorkflowAction(
    actorId: string,
    patientName: string,
    requestId: string,
    actionLabel: string,
    link: string,
  ): Promise<void> {
    await this.notificationsService.notifyAdminsOfAction(
      actorId,
      'Ação na Solicitação Cirúrgica',
      `${actionLabel} — Paciente: ${patientName} (Protocolo: ${requestId})`,
      link,
      { requestId },
    );
  }
}
