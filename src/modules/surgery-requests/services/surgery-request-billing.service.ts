import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestBilling } from 'src/database/entities/surgery-request-billing.entity';
import { HealthPlan } from 'src/database/entities/health-plan.entity';

import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { ContestationRepository } from 'src/database/repositories/contestation.repository';
import { ContestationTypeEnum } from 'src/database/entities/contestation.entity';
import { MailService } from 'src/shared/mail/mail.service';
import {
  SurgeryRequestStateMachine,
  assertTransitionApplied,
} from 'src/shared/state-machine/surgery-request-state-machine';

import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';

import { InvoiceRequestDto } from '../dto/invoice-request.dto';
import { ConfirmReceiptDto } from '../dto/confirm-receipt.dto';
import { ContestPaymentDto } from '../dto/contest-payment.dto';
import { UpdateReceiptDto } from '../dto/update-receipt.dto';
import { PendencyValidatorService } from '../pendencies/pendency-validator.service';
import {
  emitSurgeryRequestStatusChanged,
  emitSurgeryRequestUpdated,
} from '../events/surgery-request.events';

@Injectable()
export class SurgeryRequestBillingService {
  private readonly logger = new Logger(SurgeryRequestBillingService.name);
  private readonly stateMachine = new SurgeryRequestStateMachine();

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    @InjectRepository(SurgeryRequestBilling)
    private readonly billingRepository: Repository<SurgeryRequestBilling>,
    private readonly contestationRepository: ContestationRepository,
    private readonly pendencyValidator: PendencyValidatorService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async invoiceRequest(id: string, dto: InvoiceRequestDto, userId: string) {
    const request = await this.surgeryRequestRepository.findOneForBilling({
      id,
    });
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    this.stateMachine.assertCanTransition(
      request,
      SurgeryRequestStatus.INVOICED,
    );
    await this.pendencyValidator.assertCanAdvance(id);

    let paymentDeadline: Date | null = null;
    if (dto.paymentDeadline) {
      paymentDeadline = new Date(dto.paymentDeadline);
    } else if (request.healthPlan?.defaultPaymentDays) {
      const d = new Date(dto.invoiceSentAt);
      d.setDate(d.getDate() + request.healthPlan.defaultPaymentDays);
      paymentDeadline = d;
    }

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const applied =
          await this.surgeryRequestRepository.applyStatusTransition(manager, {
            id,
            from: request.status,
            to: SurgeryRequestStatus.INVOICED,
            userId,
          });
        assertTransitionApplied(applied);

        await manager.getRepository(SurgeryRequestBilling).save({
          surgeryRequestId: id,
          createdById: userId,
          invoiceProtocol: dto.invoiceProtocol,
          invoiceSentAt: new Date(dto.invoiceSentAt),
          invoiceValue: dto.invoiceValue,
          invoiceNotes: dto.invoiceNotes?.trim() || null,
          paymentDeadline,
        });

        if (
          dto.setAsDefaultForHealthPlan &&
          request.healthPlanId &&
          dto.paymentDeadline
        ) {
          const sentAt = new Date(dto.invoiceSentAt);
          const deadline = new Date(dto.paymentDeadline);
          const days = Math.round(
            (deadline.getTime() - sentAt.getTime()) / (1000 * 60 * 60 * 24),
          );
          await manager
            .getRepository(HealthPlan)
            .update({ id: request.healthPlanId }, { defaultPaymentDays: days });
        }
      },
      { logger: this.logger, operationName: 'invoiceRequest' },
    );

    emitSurgeryRequestStatusChanged(this.eventEmitter, {
      surgeryRequestId: id,
      from: request.status,
      to: SurgeryRequestStatus.INVOICED,
      actorId: userId,
    });
  }

  async confirmReceipt(id: string, dto: ConfirmReceiptDto, userId: string) {
    const request = await this.surgeryRequestRepository.findOneForBilling({
      id,
    });
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    this.stateMachine.assertCanTransition(
      request,
      SurgeryRequestStatus.FINALIZED,
    );
    if (!request.billing) {
      throw new NotFoundException(ERROR_MESSAGES.BILLING_NOT_FOUND);
    }
    await this.pendencyValidator.assertCanAdvance(id);

    const invoiceValue = Number(request.billing.invoiceValue);
    const receivedValue = Number(dto.receivedValue);
    const hasDivergence = receivedValue !== invoiceValue;

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const applied =
          await this.surgeryRequestRepository.applyStatusTransition(manager, {
            id,
            from: request.status,
            to: SurgeryRequestStatus.FINALIZED,
            userId,
          });
        assertTransitionApplied(applied);

        await manager.getRepository(SurgeryRequestBilling).update(
          { surgeryRequestId: id },
          {
            receivedValue,
            receivedAt: new Date(dto.receivedAt),
            receiptNotes: dto.receiptNotes,
            contestedReceivedValue: hasDivergence ? receivedValue : null,
            contestedReceivedAt: hasDivergence ? new Date() : null,
          },
        );
      },
      { logger: this.logger, operationName: 'confirmReceipt' },
    );

    emitSurgeryRequestStatusChanged(this.eventEmitter, {
      surgeryRequestId: id,
      from: request.status,
      to: SurgeryRequestStatus.FINALIZED,
      actorId: userId,
    });

    return { hasDivergence, invoiceValue, receivedValue };
  }

  async contestPayment(id: string, dto: ContestPaymentDto, userId: string) {
    const request = await this.surgeryRequestRepository.findOneForBilling({
      id,
    });
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    this.stateMachine.assertStatus(
      request,
      SurgeryRequestStatus.FINALIZED,
      'A solicitação precisa estar Finalizada para contestar pagamento.',
    );
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

    emitSurgeryRequestUpdated(this.eventEmitter, {
      surgeryRequestId: id,
      actorId: userId,
    });

    const invoiceValue = request.billing.invoiceValue
      ? formatBrl(request.billing.invoiceValue)
      : '—';
    const contestedValue = formatBrl(request.billing.contestedReceivedValue);

    await this.mailService.sendPaymentContested(dto.to, dto.subject, {
      patientName: request.patient?.name ?? 'Paciente',
      requestId: request.protocol ?? id,
      invoiceValue,
      receivedValue: contestedValue,
      message: dto.message,
    });
  }

  async updateReceipt(id: string, dto: UpdateReceiptDto, userId: string) {
    const request = await this.surgeryRequestRepository.findOneForBilling({
      id,
    });
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    this.stateMachine.assertStatus(
      request,
      SurgeryRequestStatus.FINALIZED,
      'A solicitação precisa estar Finalizada.',
    );

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

    emitSurgeryRequestUpdated(this.eventEmitter, {
      surgeryRequestId: id,
      actorId: userId,
    });
  }
}

function formatBrl(value: number | string): string {
  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
}
