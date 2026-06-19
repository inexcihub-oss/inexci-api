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
import { HealthPlan } from 'src/database/entities/health-plan.entity';

import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { ContestationRepository } from 'src/database/repositories/contestation.repository';
import { ContestationTypeEnum } from 'src/database/entities/contestation.entity';
import { MailService } from 'src/shared/mail/mail.service';

import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';

import { SurgeryRequestNotificationService } from './surgery-request-notification.service';
import { InvoiceRequestDto } from '../dto/invoice-request.dto';
import { ConfirmReceiptDto } from '../dto/confirm-receipt.dto';
import { ContestPaymentDto } from '../dto/contest-payment.dto';
import { UpdateReceiptDto } from '../dto/update-receipt.dto';

@Injectable()
export class SurgeryRequestBillingService {
  private readonly logger = new Logger(SurgeryRequestBillingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    @InjectRepository(SurgeryRequestBilling)
    private readonly billingRepository: Repository<SurgeryRequestBilling>,
    private readonly contestationRepository: ContestationRepository,
    private readonly notificationService: SurgeryRequestNotificationService,
  ) {}

  // ============================================================
  // FATURAMENTO E RECEBIMENTO
  // ============================================================

  async invoiceRequest(id: string, dto: InvoiceRequestDto, userId: string) {
    const request = await this.surgeryRequestRepository.findOneWithAllRelations(
      { id },
    );
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    if (request.status !== SurgeryRequestStatus.PERFORMED) {
      throw new BadRequestException(
        'A solicitação precisa estar Realizada para ser faturada.',
      );
    }

    return executeInTransaction(
      this.dataSource,
      async (manager) => {
        const repo = manager.getRepository(SurgeryRequest);
        const billingRepo = manager.getRepository(SurgeryRequestBilling);

        let paymentDeadline: Date | null = null;
        if (dto.paymentDeadline) {
          paymentDeadline = new Date(dto.paymentDeadline);
        } else if (request.healthPlan?.defaultPaymentDays) {
          const d = new Date(dto.invoiceSentAt);
          d.setDate(d.getDate() + request.healthPlan.defaultPaymentDays);
          paymentDeadline = d;
        }

        await billingRepo.save({
          surgeryRequestId: id,
          createdById: userId,
          invoiceProtocol: dto.invoiceProtocol,
          invoiceSentAt: new Date(dto.invoiceSentAt),
          invoiceValue: dto.invoiceValue,
          invoiceNotes: dto.invoiceNotes?.trim() || null,
          paymentDeadline: paymentDeadline,
        });

        if (
          dto.setAsDefaultForHealthPlan &&
          request.healthPlanId &&
          dto.paymentDeadline
        ) {
          const hpRepo = manager.getRepository(HealthPlan);
          const sentAt = new Date(dto.invoiceSentAt);
          const deadline = new Date(dto.paymentDeadline);
          const days = Math.round(
            (deadline.getTime() - sentAt.getTime()) / (1000 * 60 * 60 * 24),
          );
          await hpRepo.update(
            { id: request.healthPlanId },
            { defaultPaymentDays: days },
          );
        }

        await repo.update({ id }, { status: SurgeryRequestStatus.INVOICED });
        await this.surgeryRequestRepository.recordStatusChange(
          manager,
          id,
          request.status,
          SurgeryRequestStatus.INVOICED,
          userId,
        );
      },
      { logger: this.logger, operationName: 'invoiceRequest' },
    );
  }

  async confirmReceipt(id: string, dto: ConfirmReceiptDto, userId: string) {
    const request = await this.surgeryRequestRepository.findOneWithAllRelations(
      { id },
    );
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    if (request.status !== SurgeryRequestStatus.INVOICED) {
      throw new BadRequestException(
        'A solicitação precisa estar Faturada para confirmar recebimento.',
      );
    }
    if (!request.billing) {
      throw new NotFoundException(ERROR_MESSAGES.BILLING_NOT_FOUND);
    }

    return executeInTransaction(
      this.dataSource,
      async (manager) => {
        const repo = manager.getRepository(SurgeryRequest);
        const billingRepo = manager.getRepository(SurgeryRequestBilling);

        const invoiceValue = Number(request.billing!.invoiceValue);
        const receivedValue = Number(dto.receivedValue);
        const hasDivergence = receivedValue !== invoiceValue;

        await billingRepo.update(
          { surgeryRequestId: id },
          {
            receivedValue: receivedValue,
            receivedAt: new Date(dto.receivedAt),
            receiptNotes: dto.receiptNotes,
            contestedReceivedValue: hasDivergence ? receivedValue : null,
            contestedReceivedAt: hasDivergence ? new Date() : null,
          },
        );

        await repo.update({ id }, { status: SurgeryRequestStatus.FINALIZED });
        await this.surgeryRequestRepository.recordStatusChange(
          manager,
          id,
          request.status,
          SurgeryRequestStatus.FINALIZED,
          userId,
        );

        return { hasDivergence, invoiceValue, receivedValue };
      },
      { logger: this.logger, operationName: 'confirmReceipt' },
    );
  }

  async contestPayment(id: string, dto: ContestPaymentDto, userId: string) {
    const request = await this.surgeryRequestRepository.findOneWithAllRelations(
      { id },
    );
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    if (request.status !== SurgeryRequestStatus.FINALIZED) {
      throw new BadRequestException(
        'A solicitação precisa estar Finalizada para contestar pagamento.',
      );
    }
    if (!request.billing?.contestedReceivedValue) {
      throw new BadRequestException(
        'Não há divergência de recebimento registrada.',
      );
    }

    await this.contestationRepository.create({
      surgeryRequestId: id,
      createdById: userId,
      type: ContestationTypeEnum.PAYMENT,
      reason: dto.message,
    });

    const invoiceValue = request.billing?.invoiceValue
      ? `R$ ${Number(request.billing.invoiceValue).toFixed(2).replace('.', ',')}`
      : '—';
    const contestedValue = request.billing?.contestedReceivedValue
      ? `R$ ${Number(request.billing.contestedReceivedValue).toFixed(2).replace('.', ',')}`
      : '—';

    await this.mailService.sendPaymentContested(dto.to, dto.subject, {
      patientName: request.patient?.name ?? 'Paciente',
      requestId: request.protocol ?? id,
      invoiceValue,
      receivedValue: contestedValue,
      message: dto.message,
    });
  }

  async updateReceipt(id: string, dto: UpdateReceiptDto, _userId: string) {
    const request = await this.surgeryRequestRepository.findOneWithAllRelations(
      { id },
    );
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    if (request.status !== SurgeryRequestStatus.FINALIZED) {
      throw new BadRequestException('A solicitação precisa estar Finalizada.');
    }

    if (!request.billing?.contestedReceivedValue) {
      throw new BadRequestException(
        'Não há divergência de recebimento para editar.',
      );
    }

    await this.billingRepository.update(
      { surgeryRequestId: id },
      {
        receivedValue: dto.receivedValue,
        receivedAt: new Date(dto.receivedAt),
      },
    );
  }
}
