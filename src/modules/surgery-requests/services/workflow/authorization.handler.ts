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
import {
  Contestation,
  ContestationTypeEnum,
} from 'src/database/entities/contestation.entity';
import {
  SurgeryRequestActivity,
  ActivityType,
} from 'src/database/entities/surgery-request-activity.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { ContestationRepository } from 'src/database/repositories/contestation.repository';
import { SendMethod } from 'src/shared/constants/send-method';
import { MailService } from 'src/shared/mail/mail.service';
import { StorageService } from 'src/shared/storage/storage.service';
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
    private readonly storageService: StorageService,
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
            surgeryRequestId: id,
            type: ContestationTypeEnum.AUTHORIZATION,
            resolvedAt: null,
          },
          { resolvedAt: new Date() },
        );

        await repo.update(
          { id },
          {
            status: SurgeryRequestStatus.IN_SCHEDULING,
            dateOptions: dto.dateOptions,
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

    await this.notificationService.notifyAdminsOfWorkflowAction(
      userId,
      request.patient?.name ?? 'Paciente',
      request.protocol ?? id,
      'Autorização aceita',
      `/solicitacao/${id}`,
    );

    await this.notificationService.notifyStakeholdersOfStatusChange(
      request,
      request.status,
      SurgeryRequestStatus.IN_SCHEDULING,
      userId,
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
      surgeryRequestId: id,
      createdById: userId,
      type: ContestationTypeEnum.AUTHORIZATION,
      reason: dto.reason,
    });

    const patientName = request.patient?.name ?? 'Paciente';
    const requestId = request.protocol ?? id;

    await this.notificationService.notifyAdminsOfWorkflowAction(
      userId,
      patientName,
      requestId,
      'Autorização contestada',
      `/solicitacao/${id}`,
    );

    // ── Registrar atividade de contestação ────────────────────────────────
    const activityRepo = this.dataSource.getRepository(SurgeryRequestActivity);
    await activityRepo.save({
      surgeryRequestId: id,
      userId: userId,
      type: ActivityType.SYSTEM,
      content: 'Autorização contestada.',
    });

    if (dto.method === SendMethod.EMAIL && dto.to) {
      let pdfAttachment:
        | { filename: string; content: string; contentType: string }
        | undefined;
      try {
        const pdfBuffer =
          await this.pdfAssemblyService.generateContestAuthorizationPdf(
            request,
            id,
            userId,
          );
        pdfAttachment = {
          filename: `contestacao-${request.protocol ?? id}.pdf`,
          content: pdfBuffer.toString('base64'),
          contentType: 'application/pdf',
        };
      } catch (err) {
        this.logger.warn(
          `[contestAuthorization] Não foi possível gerar PDF para anexar ao e-mail da contestação ${id}: ${err?.message}`,
        );
      }

      await this.mailService.sendSurgeryContested(
        dto.to,
        dto.subject ?? 'Contestação de Autorização — Inexci',
        {
          patientName,
          requestId,
          reason: dto.reason,
          message: dto.message,
        },
        pdfAttachment ? [pdfAttachment] : undefined,
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

    const buffer =
      await this.pdfAssemblyService.generateContestAuthorizationPdf(
        request,
        id,
        userId,
      );

    // ── Salvar PDF no storage e registrar atividade ───────────────────────
    try {
      const timestamp = Date.now();
      const filename = `contestacao-${id}-${timestamp}.pdf`;
      const mockFile = {
        originalname: filename,
        mimetype: 'application/pdf',
        buffer,
      };
      const storagePath = await this.storageService.create(mockFile, 'pdfs');

      const activityRepo = this.dataSource.getRepository(
        SurgeryRequestActivity,
      );
      await activityRepo.save({
        surgeryRequestId: id,
        userId: null,
        type: ActivityType.PDF_GENERATED,
        content: JSON.stringify({
          description: 'PDF de contestação de autorização gerado',
          pdf_path: storagePath,
        }),
      });

      this.logger.log(`[contestPDF] PDF de contestação salvo: ${storagePath}`);
    } catch (err: any) {
      this.logger.warn(
        `[contestPDF] Não foi possível salvar atividade do PDF de contestação: ${err?.message}`,
      );
    }

    return buffer;
  }
}
