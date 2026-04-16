import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestBilling } from 'src/database/entities/surgery-request-billing.entity';
import { Contestation } from 'src/database/entities/contestation.entity';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { StatusUpdate } from 'src/database/entities/status-update.entity';
import {
  SurgeryRequestActivity,
  ActivityType,
} from 'src/database/entities/surgery-request-activity.entity';

import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { MailService } from 'src/shared/mail/mail.service';

import { SurgeryRequestNotificationService } from './surgery-request-notification.service';
import { InvoiceRequestDto } from '../dto/invoice-request.dto';
import { ConfirmReceiptDto } from '../dto/confirm-receipt.dto';
import { ContestPaymentDto } from '../dto/contest-payment.dto';
import { UpdateReceiptDto } from '../dto/update-receipt.dto';

import { getStatusLabel } from 'src/shared/utils';

@Injectable()
export class SurgeryRequestBillingService {
  private readonly logger = new Logger(SurgeryRequestBillingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    @InjectRepository(SurgeryRequestBilling)
    private readonly billingRepository: Repository<SurgeryRequestBilling>,
    @InjectRepository(Contestation)
    private readonly contestationRepository: Repository<Contestation>,
    private readonly notificationService: SurgeryRequestNotificationService,
  ) {}

  // ============================================================
  // HELPERS PRIVADOS
  // ============================================================

  private async loadRequestWithRelations(id: string): Promise<SurgeryRequest> {
    const request = await this.surgeryRequestRepository.findOneWithRelations(
      { id },
      [
        'created_by',
        'patient',
        'hospital',
        'health_plan',
        'tuss_items',
        'opme_items',
        'documents',
        'analysis',
        'billing',
        'contestations',
      ],
    );
    if (!request) throw new NotFoundException('Solicitação não encontrada');
    return request;
  }

  private async recordStatusChange(
    manager: any,
    surgeryRequestId: string,
    prevStatus: SurgeryRequestStatus,
    newStatus: SurgeryRequestStatus,
    userId: string | null = null,
  ): Promise<void> {
    const statusUpdateRepo = manager.getRepository(StatusUpdate);
    await statusUpdateRepo.save({
      surgery_request_id: surgeryRequestId,
      prev_status: prevStatus,
      new_status: newStatus,
    });

    const activityRepo = manager.getRepository(SurgeryRequestActivity);
    const prevLabel = getStatusLabel(prevStatus);
    const newLabel = getStatusLabel(newStatus);
    await activityRepo.save({
      surgery_request_id: surgeryRequestId,
      user_id: userId,
      type: ActivityType.STATUS_CHANGE,
      content: `Status alterado de "${prevLabel}" para "${newLabel}"`,
    });
  }

  // ============================================================
  // FATURAMENTO E RECEBIMENTO
  // ============================================================

  async invoiceRequest(id: string, dto: InvoiceRequestDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    if (request.status !== SurgeryRequestStatus.PERFORMED) {
      throw new BadRequestException(
        'A solicitação precisa estar Realizada para ser faturada.',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      const billingRepo = manager.getRepository(SurgeryRequestBilling);

      let paymentDeadline: Date | null = null;
      if (dto.payment_deadline) {
        paymentDeadline = new Date(dto.payment_deadline);
      } else if (request.health_plan?.default_payment_days) {
        const d = new Date(dto.invoice_sent_at);
        d.setDate(d.getDate() + request.health_plan.default_payment_days);
        paymentDeadline = d;
      }

      await billingRepo.save({
        surgery_request_id: id,
        created_by_id: userId,
        invoice_protocol: dto.invoice_protocol,
        invoice_sent_at: new Date(dto.invoice_sent_at),
        invoice_value: dto.invoice_value,
        payment_deadline: paymentDeadline,
      });

      if (
        dto.set_as_default_for_health_plan &&
        request.health_plan_id &&
        dto.payment_deadline
      ) {
        const hpRepo = manager.getRepository(HealthPlan);
        const sentAt = new Date(dto.invoice_sent_at);
        const deadline = new Date(dto.payment_deadline);
        const days = Math.round(
          (deadline.getTime() - sentAt.getTime()) / (1000 * 60 * 60 * 24),
        );
        await hpRepo.update(
          { id: request.health_plan_id },
          { default_payment_days: days },
        );
      }

      await repo.update({ id }, { status: SurgeryRequestStatus.INVOICED });
      await this.recordStatusChange(
        manager,
        id,
        request.status,
        SurgeryRequestStatus.INVOICED,
        userId,
      );
    });
  }

  async confirmReceipt(id: string, dto: ConfirmReceiptDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    if (request.status !== SurgeryRequestStatus.INVOICED) {
      throw new BadRequestException(
        'A solicitação precisa estar Faturada para confirmar recebimento.',
      );
    }
    if (!request.billing) {
      throw new BadRequestException('Dados de faturamento não encontrados.');
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      const billingRepo = manager.getRepository(SurgeryRequestBilling);

      const invoiceValue = Number(request.billing.invoice_value);
      const receivedValue = Number(dto.received_value);
      const hasDivergence = receivedValue !== invoiceValue;

      await billingRepo.update(
        { surgery_request_id: id },
        {
          received_value: receivedValue,
          received_at: new Date(dto.received_at),
          receipt_notes: dto.receipt_notes,
          contested_received_value: hasDivergence ? receivedValue : null,
          contested_received_at: hasDivergence ? new Date() : null,
        },
      );

      await repo.update({ id }, { status: SurgeryRequestStatus.FINALIZED });
      await this.recordStatusChange(
        manager,
        id,
        request.status,
        SurgeryRequestStatus.FINALIZED,
        userId,
      );

      return { hasDivergence, invoiceValue, receivedValue };
    });
  }

  async contestPayment(id: string, dto: ContestPaymentDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    if (request.status !== SurgeryRequestStatus.FINALIZED) {
      throw new BadRequestException(
        'A solicitação precisa estar Finalizada para contestar pagamento.',
      );
    }
    if (!request.billing?.contested_received_value) {
      throw new BadRequestException(
        'Não há divergência de recebimento registrada.',
      );
    }

    await this.contestationRepository.save({
      surgery_request_id: id,
      created_by_id: userId,
      type: 'payment',
      reason: dto.message,
    });

    const invoiceValue = request.billing?.invoice_value
      ? `R$ ${Number(request.billing.invoice_value).toFixed(2).replace('.', ',')}`
      : '—';
    const contestedValue = request.billing?.contested_received_value
      ? `R$ ${Number(request.billing.contested_received_value).toFixed(2).replace('.', ',')}`
      : '—';

    await this.mailService.sendPaymentContested(dto.to, dto.subject, {
      patientName: request.patient?.name ?? 'Paciente',
      requestId: request.protocol ?? id,
      invoiceValue,
      receivedValue: contestedValue,
      message: dto.message,
    });
  }

  async updateReceipt(id: string, dto: UpdateReceiptDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    if (request.status !== SurgeryRequestStatus.FINALIZED) {
      throw new BadRequestException('A solicitação precisa estar Finalizada.');
    }

    if (!request.billing?.contested_received_value) {
      throw new BadRequestException(
        'Não há divergência de recebimento para editar.',
      );
    }

    await this.billingRepository.update(
      { surgery_request_id: id },
      {
        received_value: dto.received_value,
        received_at: new Date(dto.received_at),
      },
    );
  }
}
