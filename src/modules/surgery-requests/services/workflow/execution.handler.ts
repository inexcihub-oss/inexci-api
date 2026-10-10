import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import {
  SurgeryRequestStateMachine,
  assertTransitionApplied,
} from 'src/shared/state-machine/surgery-request-state-machine';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';

import { SurgeryRequestNotificationService } from '../surgery-request-notification.service';
import { MarkPerformedDto } from '../../dto/mark-performed.dto';
import { CloseSurgeryRequestDto } from '../../dto/close-surgery-request.dto';
import { PendencyValidatorService } from '../../pendencies/pendency-validator.service';
import { emitSurgeryRequestStatusChanged } from '../../events/surgery-request.events';

@Injectable()
export class ExecutionHandler {
  private readonly logger = new Logger(ExecutionHandler.name);
  private readonly stateMachine = new SurgeryRequestStateMachine();

  constructor(
    private readonly dataSource: DataSource,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly notificationService: SurgeryRequestNotificationService,
    private readonly pendencyValidator: PendencyValidatorService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async markPerformed(id: string, dto: MarkPerformedDto, userId: string) {
    this.logger.log(
      `[markPerformed] Marcando solicitação ${id} como realizada`,
    );
    const request = await this.surgeryRequestRepository.findOneForWorkflow({
      id,
    });
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    this.stateMachine.assertCanTransition(
      request,
      SurgeryRequestStatus.PERFORMED,
    );
    await this.pendencyValidator.assertCanAdvance(id);

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const applied =
          await this.surgeryRequestRepository.applyStatusTransition(manager, {
            id,
            from: request.status,
            to: SurgeryRequestStatus.PERFORMED,
            data: { surgeryPerformedAt: new Date(dto.surgeryPerformedAt) },
            userId,
          });
        assertTransitionApplied(applied);
      },
      { logger: this.logger, operationName: 'markPerformed' },
    );

    emitSurgeryRequestStatusChanged(this.eventEmitter, {
      surgeryRequestId: id,
      from: request.status,
      to: SurgeryRequestStatus.PERFORMED,
      actorId: userId,
    });

    await this.notificationService.notifyStakeholdersOfStatusChange(
      request,
      request.status,
      SurgeryRequestStatus.PERFORMED,
      userId,
    );
    await this.notificationService.notifyPatientIfRequested(
      request,
      request.status,
      SurgeryRequestStatus.PERFORMED,
      dto.notifyPatient,
    );
  }

  async closeSurgeryRequest(
    id: string,
    dto: CloseSurgeryRequestDto,
    userId: string,
  ) {
    this.logger.log(`[closeSurgeryRequest] Encerrando solicitação ${id}`);
    const request = await this.surgeryRequestRepository.findOneSimple({ id });
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);

    this.stateMachine.assertCanTransition(request, SurgeryRequestStatus.CLOSED);

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const applied =
          await this.surgeryRequestRepository.applyStatusTransition(manager, {
            id,
            from: request.status,
            to: SurgeryRequestStatus.CLOSED,
            data: { closedAt: new Date(), closedReason: dto.reason },
            userId,
            note: dto.reason,
          });
        assertTransitionApplied(applied);
      },
      { logger: this.logger, operationName: 'closeSurgeryRequest' },
    );

    emitSurgeryRequestStatusChanged(this.eventEmitter, {
      surgeryRequestId: id,
      from: request.status,
      to: SurgeryRequestStatus.CLOSED,
      actorId: userId,
    });
  }
}
