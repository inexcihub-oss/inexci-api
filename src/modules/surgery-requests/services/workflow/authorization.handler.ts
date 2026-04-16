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
import { Contestation } from 'src/database/entities/contestation.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { ContestationRepository } from 'src/database/repositories/contestation.repository';
import { SendMethod } from 'src/shared/constants/send-method';
import { MailService } from 'src/shared/mail/mail.service';
import { SurgeryRequestStateMachine } from 'src/shared/state-machine/surgery-request-state-machine';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';

import { SurgeryRequestNotificationService } from '../surgery-request-notification.service';
import { SurgeryRequestPdfAssemblyService } from '../surgery-request-pdf-assembly.service';
import { AcceptAuthorizationDto } from '../../dto/accept-authorization.dto';
import { ContestAuthorizationDto } from '../../dto/contest-authorization.dto';

@Injectable()
export class AuthorizationHandler {
  private readonly logger = new Logger(AuthorizationHandler.name);
  private readonly stateMachine = new SurgeryRequestStateMachine();

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly contestationRepository: ContestationRepository,
    private readonly notificationService: SurgeryRequestNotificationService,
    private readonly pdfAssemblyService: SurgeryRequestPdfAssemblyService,
  ) {}

  async acceptAuthorization(
    id: string,
    dto: AcceptAuthorizationDto,
    userId: string,
  ) {
    this.logger.log(
      `[acceptAuthorization] Aceitando autorização da solicitação ${id}`,
    );
    const request = await this.surgeryRequestRepository.findOneWithAllRelations(
      { id },
    );
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    this.stateMachine.assertCanTransition(
      request,
      SurgeryRequestStatus.IN_SCHEDULING,
    );

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const repo = manager.getRepository(SurgeryRequest);
        const contestRepo = manager.getRepository(Contestation);

        await contestRepo.update(
          {
            surgery_request_id: id,
            type: 'authorization',
            resolved_at: null,
          },
          { resolved_at: new Date() },
        );

        await repo.update(
          { id },
          {
            status: SurgeryRequestStatus.IN_SCHEDULING,
            date_options: dto.date_options,
          },
        );
        await this.surgeryRequestRepository.recordStatusChange(
          manager,
          id,
          request.status,
          SurgeryRequestStatus.IN_SCHEDULING,
          userId,
        );
      },
      { logger: this.logger, operationName: 'acceptAuthorization' },
    );

    await this.notificationService.notifyPatientIfRequested(
      request,
      request.status,
      SurgeryRequestStatus.IN_SCHEDULING,
      dto.notify_patient,
    );
  }

  async contestAuthorization(
    id: string,
    dto: ContestAuthorizationDto,
    userId: string,
  ) {
    this.logger.log(
      `[contestAuthorization] Contestando autorização da solicitação ${id}`,
    );
    const request = await this.surgeryRequestRepository.findOneWithAllRelations(
      { id },
    );
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    if (request.status !== SurgeryRequestStatus.IN_ANALYSIS) {
      throw new BadRequestException(
        'A solicitação precisa estar Em Análise para ser contestada.',
      );
    }

    await this.contestationRepository.create({
      surgery_request_id: id,
      created_by_id: userId,
      type: 'authorization',
      reason: dto.reason,
    });

    const patientName = request.patient?.name ?? 'Paciente';
    const requestId = request.protocol ?? id;

    if (dto.method === SendMethod.EMAIL && dto.to) {
      await this.mailService.sendSurgeryContested(
        dto.to,
        dto.subject ?? 'Contestação de Autorização — Inexci',
        {
          patientName,
          requestId,
          reason: dto.reason,
          message: dto.message,
        },
      );
      return { sent: true, method: SendMethod.EMAIL };
    }

    return { sent: false, method: SendMethod.DOCUMENT };
  }

  async generateContestAuthorizationPdf(
    id: string,
    userId: string,
  ): Promise<Buffer> {
    const request = await this.surgeryRequestRepository.findOneWithAllRelations(
      { id },
    );
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    return this.pdfAssemblyService.generateContestAuthorizationPdf(
      request,
      id,
      userId,
    );
  }
}
