import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestAnalysis } from 'src/database/entities/surgery-request-analysis.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { SendMethod } from 'src/shared/constants/send-method';
import { MailService } from 'src/shared/mail/mail.service';
import { PdfGenerationService } from 'src/shared/pdf/pdf-generation.service';
import { StorageService } from 'src/shared/storage/storage.service';
import {
  SurgeryRequestStateMachine,
  assertTransitionApplied,
} from 'src/shared/state-machine/surgery-request-state-machine';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import {
  parseCalendarDate,
  todayCalendarDate,
} from 'src/shared/utils/date.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';
import { DOCUMENT_KEYS } from 'src/shared/constants/document-keys';

import { SurgeryRequestNotificationService } from '../surgery-request-notification.service';
import { SurgeryRequestPdfAssemblyService } from '../surgery-request-pdf-assembly.service';
import { SendRequestDto } from '../../dto/send-request.dto';
import { StartAnalysisDto } from '../../dto/start-analysis.dto';
import { QuotaService } from 'src/modules/billing/services/quota.service';
import { PendencyValidatorService } from '../../pendencies/pendency-validator.service';
import { emitSurgeryRequestStatusChanged } from '../../events/surgery-request.events';

interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

@Injectable()
export class SendAnalysisHandler {
  private readonly logger = new Logger(SendAnalysisHandler.name);
  private readonly stateMachine = new SurgeryRequestStateMachine();

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly pdfGenerationService: PdfGenerationService,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly notificationService: SurgeryRequestNotificationService,
    private readonly pdfAssemblyService: SurgeryRequestPdfAssemblyService,
    private readonly quotaService: QuotaService,
    private readonly documentRepository: DocumentRepository,
    private readonly storageService: StorageService,
    private readonly pendencyValidator: PendencyValidatorService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async exportSurgeryRequestPdf(id: string, userId: string): Promise<Buffer> {
    const request = await this.surgeryRequestRepository.findOneWithAllRelations(
      { id },
    );
    if (!request) throw new NotFoundException('Solicitação não encontrada');
    const { pdf } = await this.pdfAssemblyService.generateLaudoPdf(
      request,
      userId,
    );
    return Buffer.from(pdf, 'base64');
  }

  async sendRequest(id: string, dto: SendRequestDto, userId: string) {
    this.logger.log(
      `[sendRequest] Iniciando envio da solicitação ${id} por usuário ${userId}`,
    );
    const request = await this.surgeryRequestRepository.findOneWithAllRelations(
      { id },
    );
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    this.stateMachine.assertCanTransition(request, SurgeryRequestStatus.SENT);
    await this.pendencyValidator.assertCanAdvance(id);

    const sentAt = this.resolveSentAt(dto);
    const sendsEmail = dto.method === SendMethod.EMAIL && !!dto.to;

    const sourceAttachment =
      sendsEmail && dto.useSourceDocument
        ? await this.loadSourceDocumentAttachment(request)
        : null;
    const extraAttachments = sendsEmail
      ? await this.loadExtraAttachments(id, dto.attachments ?? [])
      : [];

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const applied =
          await this.surgeryRequestRepository.applyStatusTransition(manager, {
            id,
            from: request.status,
            to: SurgeryRequestStatus.SENT,
            data: { sentAt, sendMethod: dto.method },
            userId,
            statusChangedAt: sentAt,
          });
        assertTransitionApplied(applied);

        await this.quotaService.consumeSurgeryRequest(request.ownerId, {
          manager,
        });
      },
      { logger: this.logger, operationName: 'sendRequest' },
    );

    emitSurgeryRequestStatusChanged(this.eventEmitter, {
      surgeryRequestId: id,
      from: request.status,
      to: SurgeryRequestStatus.SENT,
      actorId: userId,
    });

    await this.notificationService.notifyStakeholdersOfStatusChange(
      request,
      SurgeryRequestStatus.PENDING,
      SurgeryRequestStatus.SENT,
      userId,
    );

    try {
      void this.pdfGenerationService.scheduleGeneration(id, userId);
    } catch (err) {
      this.logger.warn(
        `Falha ao agendar geração de PDF para solicitação ${id}: ${(err as Error)?.message}`,
      );
    }

    if (sendsEmail && dto.to) {
      const primaryAttachment =
        sourceAttachment ??
        (await this.tryBuildLaudoAttachment(request, userId));
      const mailAttachments = [
        ...(primaryAttachment ? [primaryAttachment] : []),
        ...extraAttachments,
      ];

      await this.mailService.sendSurgeryRequestSent(
        dto.to,
        {
          patientName: request.patient?.name ?? 'Paciente',
          requestId: request.protocol ?? id,
          hospitalName: request.hospital?.name ?? '',
          healthPlanName: request.healthPlan?.name ?? '',
          doctorName: request.createdBy?.name ?? 'Médico',
        },
        mailAttachments.length > 0 ? mailAttachments : undefined,
        dto.cc,
      );
      this.logger.log(
        `[AI_SEND_SC] id=${id} method=email to=${dto.to} attachments=${mailAttachments.length}`,
      );
      return { sent: true, method: SendMethod.EMAIL };
    }

    if (dto.method === SendMethod.DOWNLOAD) {
      this.logger.log(`[sendRequest] Solicitação ${id} enviada via download`);
      return this.pdfAssemblyService.generateLaudoPdf(request, userId);
    }

    if (dto.method === SendMethod.DOCUMENT) {
      this.logger.log(
        `[sendRequest] Solicitação ${id} confirmada com documento de origem`,
      );
      return { sent: true, method: SendMethod.DOCUMENT };
    }

    this.logger.log(`[sendRequest] Solicitação ${id} enviada com sucesso`);
    return { sent: true };
  }

  async startAnalysis(id: string, dto: StartAnalysisDto, userId: string) {
    this.logger.log(
      `[startAnalysis] Iniciando análise da solicitação ${id} por usuário ${userId}`,
    );
    const request = await this.surgeryRequestRepository.findOneForWorkflow({
      id,
    });
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    this.stateMachine.assertCanTransition(
      request,
      SurgeryRequestStatus.IN_ANALYSIS,
    );
    await this.pendencyValidator.assertCanAdvance(id);

    const receivedAt = parseCalendarDate(dto.receivedAt);

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const applied =
          await this.surgeryRequestRepository.applyStatusTransition(manager, {
            id,
            from: request.status,
            to: SurgeryRequestStatus.IN_ANALYSIS,
            userId,
            statusChangedAt: receivedAt,
          });
        assertTransitionApplied(applied);

        await manager.getRepository(SurgeryRequestAnalysis).save({
          surgeryRequestId: id,
          requestNumber: dto.requestNumber,
          receivedAt,
          quotation1Number: dto.quotation1Number,
          quotation1ReceivedAt: dto.quotation1ReceivedAt
            ? parseCalendarDate(dto.quotation1ReceivedAt)
            : null,
          quotation2Number: dto.quotation2Number,
          quotation2ReceivedAt: dto.quotation2ReceivedAt
            ? parseCalendarDate(dto.quotation2ReceivedAt)
            : null,
          quotation3Number: dto.quotation3Number,
          quotation3ReceivedAt: dto.quotation3ReceivedAt
            ? parseCalendarDate(dto.quotation3ReceivedAt)
            : null,
          notes: dto.notes,
        });
      },
      { logger: this.logger, operationName: 'startAnalysis' },
    );

    emitSurgeryRequestStatusChanged(this.eventEmitter, {
      surgeryRequestId: id,
      from: request.status,
      to: SurgeryRequestStatus.IN_ANALYSIS,
      actorId: userId,
    });

    await this.notificationService.notifyStakeholdersOfStatusChange(
      request,
      SurgeryRequestStatus.SENT,
      SurgeryRequestStatus.IN_ANALYSIS,
      userId,
    );
    this.logger.log(`[startAnalysis] Solicitação ${id} movida para Em Análise`);
  }

  private resolveSentAt(dto: SendRequestDto): Date {
    const sentAt =
      dto.method === SendMethod.DOCUMENT && dto.sentAt
        ? parseCalendarDate(dto.sentAt)
        : new Date();
    if (Number.isNaN(sentAt.getTime())) {
      throw new BadRequestException('Data de envio inválida.');
    }
    if (
      dto.method === SendMethod.DOCUMENT &&
      dto.sentAt &&
      sentAt.getTime() > todayCalendarDate().getTime()
    ) {
      throw new BadRequestException(
        'A data de envio não pode estar no futuro.',
      );
    }
    return sentAt;
  }

  private async loadSourceDocumentAttachment(
    request: SurgeryRequest,
  ): Promise<MailAttachment> {
    const sourceDoc = (request.documents ?? []).find(
      (doc) => doc.key === DOCUMENT_KEYS.SC_CREATION_SOURCE && doc.uri,
    );
    if (!sourceDoc?.uri) {
      throw new BadRequestException(
        'Documento de origem não encontrado nesta solicitação.',
      );
    }
    let buffer: Buffer | null = null;
    try {
      buffer = await this.storageService.download(sourceDoc.uri);
    } catch (err) {
      this.logger.warn(
        `[sendRequest] Falha ao baixar documento de origem ${sourceDoc.id}: ${(err as Error)?.message}`,
      );
    }
    if (!buffer) {
      throw new BadRequestException(
        'Não foi possível anexar o documento de origem ao e-mail.',
      );
    }
    return {
      filename:
        sourceDoc.name ||
        sourceDoc.uri.split('/').pop() ||
        `documento-origem-${request.id}`,
      content: buffer,
      contentType: 'application/octet-stream',
    };
  }

  private async loadExtraAttachments(
    surgeryRequestId: string,
    attachmentIds: string[],
  ): Promise<MailAttachment[]> {
    if (attachmentIds.length === 0) return [];

    const docs = await Promise.all(
      attachmentIds.map((docId) =>
        this.documentRepository.findOne({ id: docId }),
      ),
    );
    const invalid = docs.some(
      (doc) => !doc || doc.surgeryRequestId !== surgeryRequestId,
    );
    if (invalid) {
      throw new BadRequestException(
        'Um ou mais anexos não pertencem a esta solicitação.',
      );
    }

    const attachments: MailAttachment[] = [];
    for (const doc of docs) {
      if (!doc?.uri) continue;
      try {
        const buffer = await this.storageService.download(doc.uri);
        if (!buffer) continue;
        attachments.push({
          filename:
            doc.name || doc.uri.split('/').pop() || `documento-${doc.id}`,
          content: buffer,
          contentType: 'application/octet-stream',
        });
      } catch (err) {
        this.logger.warn(
          `[sendRequest] Falha ao baixar anexo ${doc.id}: ${(err as Error)?.message}`,
        );
      }
    }
    return attachments;
  }

  private async tryBuildLaudoAttachment(
    request: SurgeryRequest,
    userId: string,
  ): Promise<MailAttachment | null> {
    try {
      const { pdf } = await this.pdfAssemblyService.generateLaudoPdf(
        request,
        userId,
      );
      return {
        filename: `solicitacao-${request.protocol ?? request.id}.pdf`,
        content: Buffer.from(pdf, 'base64'),
        contentType: 'application/pdf',
      };
    } catch (err) {
      this.logger.warn(
        `[sendRequest] Não foi possível gerar PDF para anexar ao e-mail da solicitação ${request.id}: ${(err as Error)?.message}`,
      );
      return null;
    }
  }
}
