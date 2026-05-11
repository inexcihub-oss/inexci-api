import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { POST_SURGERY_REQUIRED_DOCS } from 'src/config/post-surgery-documents.config';
import { SurgeryRequestStateMachine } from 'src/shared/state-machine/surgery-request-state-machine';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';

import { SurgeryRequestNotificationService } from '../surgery-request-notification.service';
import { MarkPerformedDto } from '../../dto/mark-performed.dto';
import { CloseSurgeryRequestDto } from '../../dto/close-surgery-request.dto';

@Injectable()
export class ExecutionHandler {
  private readonly logger = new Logger(ExecutionHandler.name);
  private readonly stateMachine = new SurgeryRequestStateMachine();

  constructor(
    private readonly dataSource: DataSource,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly documentRepository: DocumentRepository,
    private readonly notificationService: SurgeryRequestNotificationService,
  ) {}

  async markPerformed(id: string, dto: MarkPerformedDto, userId: string) {
    this.logger.log(
      `[markPerformed] Marcando solicitação ${id} como realizada`,
    );
    const request = await this.surgeryRequestRepository.findOneWithAllRelations(
      { id },
    );
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    this.stateMachine.assertCanTransition(
      request,
      SurgeryRequestStatus.PERFORMED,
    );

    // Garante que os documentos pós-cirúrgicos obrigatórios estejam anexados
    // antes da transição SCHEDULED → PERFORMED. Mesmas keys que o
    // `SurgeryStatusModal` exige no frontend.
    const docs = await this.documentRepository.findMany({
      surgeryRequestId: id,
    });
    const presentKeys = new Set(
      (docs ?? []).map((d) => d.key).filter((k): k is string => !!k),
    );
    const missingRequiredDocs = POST_SURGERY_REQUIRED_DOCS.filter(
      (d) => d.required && !presentKeys.has(d.type),
    );
    if (missingRequiredDocs.length > 0) {
      throw new BadRequestException(
        `Para marcar a cirurgia como realizada é necessário anexar: ${missingRequiredDocs
          .map((d) => d.label)
          .join(', ')}.`,
      );
    }

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const repo = manager.getRepository(SurgeryRequest);
        await repo.update(
          { id },
          {
            status: SurgeryRequestStatus.PERFORMED,
            surgeryPerformedAt: new Date(dto.surgeryPerformedAt),
          },
        );
        await this.surgeryRequestRepository.recordStatusChange(
          manager,
          id,
          request.status,
          SurgeryRequestStatus.PERFORMED,
          userId,
        );
      },
      { logger: this.logger, operationName: 'markPerformed' },
    );

    await this.notificationService.notifyAdminsOfWorkflowAction(
      userId,
      request.patient?.name ?? 'Paciente',
      request.protocol ?? id,
      'Cirurgia marcada como realizada',
      `/solicitacao/${id}`,
    );

    await this.notificationService.notifyStakeholdersOfStatusChange(
      request,
      request.status,
      SurgeryRequestStatus.PERFORMED,
      userId,
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

    return executeInTransaction(
      this.dataSource,
      async (manager) => {
        const repo = manager.getRepository(SurgeryRequest);
        await repo.update(
          { id },
          {
            status: SurgeryRequestStatus.CLOSED,
            closedAt: new Date(),
            cancelReason: dto.reason,
          },
        );
        await this.surgeryRequestRepository.recordStatusChange(
          manager,
          id,
          request.status as SurgeryRequestStatus,
          SurgeryRequestStatus.CLOSED,
          userId,
        );
      },
      { logger: this.logger, operationName: 'closeSurgeryRequest' },
    );
  }
}
