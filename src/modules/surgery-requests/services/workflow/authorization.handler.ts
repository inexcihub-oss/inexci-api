import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, In, IsNull } from 'typeorm';

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
import { Document } from 'src/database/entities/document.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from 'src/database/repositories/surgery-request-activity.repository';
import { ContestationRepository } from 'src/database/repositories/contestation.repository';
import { SendMethod } from 'src/shared/constants/send-method';
import { MailService } from 'src/shared/mail/mail.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { STORAGE_FOLDERS } from 'src/config/storage.config';
import {
  SurgeryRequestStateMachine,
  assertTransitionApplied,
} from 'src/shared/state-machine/surgery-request-state-machine';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';

import { SurgeryRequestNotificationService } from '../surgery-request-notification.service';
import { SurgeryRequestPdfAssemblyService } from '../surgery-request-pdf-assembly.service';
import { AcceptAuthorizationDto } from '../../dto/accept-authorization.dto';
import { ContestAuthorizationDto } from '../../dto/contest-authorization.dto';
import { PendencyValidatorService } from '../../pendencies/pendency-validator.service';
import {
  emitSurgeryRequestStatusChanged,
  emitSurgeryRequestUpdated,
} from '../../events/surgery-request.events';

@Injectable()
export class AuthorizationHandler {
  private readonly logger = new Logger(AuthorizationHandler.name);
  private readonly stateMachine = new SurgeryRequestStateMachine();

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly storageService: StorageService,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly activityRepository: SurgeryRequestActivityRepository,
    private readonly contestationRepository: ContestationRepository,
    private readonly notificationService: SurgeryRequestNotificationService,
    private readonly pdfAssemblyService: SurgeryRequestPdfAssemblyService,
    private readonly pendencyValidator: PendencyValidatorService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async acceptAuthorization(
    id: string,
    dto: AcceptAuthorizationDto,
    userId: string,
  ) {
    this.logger.log(
      `[acceptAuthorization] Aceitando autorização da solicitação ${id}`,
    );
    const request = await this.surgeryRequestRepository.findOneForWorkflow({
      id,
    });
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    this.stateMachine.assertCanTransition(
      request,
      SurgeryRequestStatus.IN_SCHEDULING,
    );
    await this.pendencyValidator.assertCanAdvance(id);

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const applied =
          await this.surgeryRequestRepository.applyStatusTransition(manager, {
            id,
            from: request.status,
            to: SurgeryRequestStatus.IN_SCHEDULING,
            data: { dateOptions: dto.dateOptions },
            userId,
          });
        assertTransitionApplied(applied);

        await manager.getRepository(Contestation).update(
          {
            surgeryRequestId: id,
            type: ContestationTypeEnum.AUTHORIZATION,
            resolvedAt: IsNull(),
          },
          { resolvedAt: new Date() },
        );
      },
      { logger: this.logger, operationName: 'acceptAuthorization' },
    );

    emitSurgeryRequestStatusChanged(this.eventEmitter, {
      surgeryRequestId: id,
      from: request.status,
      to: SurgeryRequestStatus.IN_SCHEDULING,
      actorId: userId,
    });

    if (dto.notifyPatient === true && (dto.dateOptions?.length ?? 0) > 0) {
      this.logger.log(
        `[acceptAuthorization] Enviando opções de agendamento ao paciente (solicitação ${id})`,
      );
      await this.notificationService.notifyPatientSchedulingOptions(
        request,
        dto.dateOptions as string[],
      );
    } else {
      this.logger.log(
        `[acceptAuthorization] Notificação ao paciente omitida (notifyPatient=${String(dto.notifyPatient)})`,
      );
    }

    await this.notificationService.notifyStakeholdersOfStatusChange(
      request,
      request.status,
      SurgeryRequestStatus.IN_SCHEDULING,
      userId,
      { sendWhatsapp: false },
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
    const request = await this.surgeryRequestRepository.findOneForWorkflow({
      id,
    });
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    this.stateMachine.assertStatus(
      request,
      SurgeryRequestStatus.IN_ANALYSIS,
      'A solicitação precisa estar Em Análise para ser contestada.',
    );

    const attachmentPaths = (dto.attachments ?? [])
      .map((path) => path?.trim())
      .filter((path): path is string => !!path);

    const contestation = await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const saved = await manager.getRepository(Contestation).save({
          surgeryRequestId: id,
          createdById: userId,
          type: ContestationTypeEnum.AUTHORIZATION,
          reason: dto.reason,
        });

        if (attachmentPaths.length > 0) {
          await manager
            .getRepository(Document)
            .update(
              { surgeryRequestId: id, uri: In(attachmentPaths) },
              { contestationId: saved.id },
            );
        }

        const activityRepo = manager.getRepository(SurgeryRequestActivity);
        await activityRepo.save({
          surgeryRequestId: id,
          userId,
          type: ActivityType.SYSTEM,
          content: 'Autorização contestada.',
        });
        if (dto.message?.trim()) {
          await activityRepo.save({
            surgeryRequestId: id,
            userId,
            type: ActivityType.SYSTEM,
            content: `Mensagem da contestação: ${dto.message.trim()}`,
          });
        }
        return saved;
      },
      { logger: this.logger, operationName: 'contestAuthorization' },
    );

    emitSurgeryRequestUpdated(this.eventEmitter, {
      surgeryRequestId: id,
      actorId: userId,
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

    if (dto.method === SendMethod.EMAIL && dto.to) {
      let pdfAttachment:
        | { filename: string; content: string; contentType: string }
        | undefined;
      try {
        const requestWithLatestData =
          await this.surgeryRequestRepository.findOneWithAllRelations({ id });
        const pdfBuffer =
          await this.pdfAssemblyService.generateContestAuthorizationPdf(
            requestWithLatestData ?? request,
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
          `[contestAuthorization] Não foi possível gerar PDF para anexar ao e-mail da contestação ${id}: ${(err as Error)?.message}`,
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
        dto.cc || undefined,
      );
      return { sent: true, method: SendMethod.EMAIL };
    }

    if (dto.method === SendMethod.DOCUMENT) {
      await this.storeContestAuthorizationPdf(
        request,
        id,
        userId,
        contestation.id,
      );
    }

    return { sent: false, method: SendMethod.DOCUMENT };
  }

  private async storeContestAuthorizationPdf(
    request: SurgeryRequest,
    id: string,
    userId: string,
    contestationId: string,
  ): Promise<void> {
    try {
      const requestWithLatestData =
        await this.surgeryRequestRepository.findOneWithAllRelations({ id });
      const buffer =
        await this.pdfAssemblyService.generateContestAuthorizationPdf(
          requestWithLatestData ?? request,
          id,
          userId,
        );
      const storagePath = await this.storageService.create(
        {
          originalname: `contestacao-${id}-${Date.now()}.pdf`,
          mimetype: 'application/pdf',
          buffer,
        },
        STORAGE_FOLDERS.PDFS,
        request.ownerId,
      );

      await this.activityRepository.create({
        surgeryRequestId: id,
        userId: null,
        type: ActivityType.PDF_GENERATED,
        content: JSON.stringify({
          description: 'PDF de contestação de autorização gerado',
          pdf_path: storagePath,
          contestation_id: contestationId,
        }),
      });

      this.logger.log(`[contestPDF] PDF de contestação salvo: ${storagePath}`);
    } catch (err) {
      this.logger.warn(
        `[contestPDF] Não foi possível salvar o PDF da contestação ${contestationId}: ${(err as Error)?.message}`,
      );
    }
  }

  async generateContestAuthorizationPdf(
    id: string,
    userId: string,
  ): Promise<Buffer> {
    const saved = await this.findSavedContestAuthorizationPdf(id);
    if (saved) return saved;

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

  private async findSavedContestAuthorizationPdf(
    id: string,
  ): Promise<Buffer | null> {
    const contestation =
      await this.contestationRepository.findLatestBySurgeryRequest(
        id,
        ContestationTypeEnum.AUTHORIZATION,
      );
    if (!contestation) return null;

    const activities = await this.activityRepository.findByTypeSince(
      id,
      ActivityType.PDF_GENERATED,
      contestation.createdAt,
    );
    for (const activity of activities) {
      const pdfPath = this.contestPdfPath(activity.content, contestation.id);
      if (!pdfPath) continue;
      const buffer = await this.storageService.download(pdfPath);
      if (buffer) return buffer;
    }
    return null;
  }

  private contestPdfPath(
    content: string,
    contestationId: string,
  ): string | null {
    try {
      const parsed = JSON.parse(content) as {
        pdf_path?: unknown;
        contestation_id?: unknown;
      };
      if (
        parsed?.contestation_id === contestationId &&
        typeof parsed.pdf_path === 'string' &&
        parsed.pdf_path
      ) {
        return parsed.pdf_path;
      }
    } catch {
      return null;
    }
    return null;
  }
}
