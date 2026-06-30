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
import { SurgeryRequestAnalysis } from 'src/database/entities/surgery-request-analysis.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { SendMethod } from 'src/shared/constants/send-method';
import { MailService } from 'src/shared/mail/mail.service';
import { PdfGenerationService } from 'src/shared/pdf/pdf-generation.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { SurgeryRequestStateMachine } from 'src/shared/state-machine/surgery-request-state-machine';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { parseCalendarDate } from 'src/shared/utils/date.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';

import { SurgeryRequestNotificationService } from '../surgery-request-notification.service';
import { SurgeryRequestPdfAssemblyService } from '../surgery-request-pdf-assembly.service';
import { SendRequestDto } from '../../dto/send-request.dto';
import { StartAnalysisDto } from '../../dto/start-analysis.dto';
import { QuotaService } from 'src/modules/billing/services/quota.service';
import { PendencyValidatorService } from '../../pendencies/pendency-validator.service';

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
  ) {}

  /**
   * Exporta o PDF da solicitação cirúrgica sem alterar o status.
   * Disponível para solicitações já enviadas (status ≥ 2).
   */
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

    // Consome cota mensal de solicitações cirúrgicas. Bloqueia se a
    // assinatura estiver suspensa, cancelada ou se o limite do plano
    // foi atingido. A unidade de cota é o ENVIO (PENDING → SENT) — rascunhos
    // não consomem.
    await this.quotaService.consumeSurgeryRequest(request.ownerId);

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const repo = manager.getRepository(SurgeryRequest);
        await repo.update(
          { id },
          {
            status: SurgeryRequestStatus.SENT,
            sentAt: new Date(),
            sendMethod: dto.method,
          },
        );
        await this.surgeryRequestRepository.recordStatusChange(
          manager,
          id,
          request.status,
          SurgeryRequestStatus.SENT,
          userId,
        );
      },
      { logger: this.logger, operationName: 'sendRequest' },
    );

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

    const doctorName = request.createdBy?.name ?? 'Médico';
    const patientName = request.patient?.name ?? 'Paciente';
    const healthPlanName = request.healthPlan?.name ?? '';
    const hospitalName = request.hospital?.name ?? '';

    if (dto.method === SendMethod.EMAIL && dto.to) {
      const mailAttachments: Array<{
        filename: string;
        content: Buffer;
        contentType: string;
      }> = [];

      try {
        const { pdf } = await this.pdfAssemblyService.generateLaudoPdf(
          request,
          userId,
        );
        mailAttachments.push({
          filename: `solicitacao-${request.protocol ?? id}.pdf`,
          content: Buffer.from(pdf, 'base64'),
          contentType: 'application/pdf',
        });
      } catch (err) {
        this.logger.warn(
          `[sendRequest] Não foi possível gerar PDF para anexar ao e-mail da solicitação ${id}: ${(err as Error)?.message}`,
        );
      }

      // Resolve documentos extras pedidos pelo cliente (IDs em
      // `documents.id`). Best-effort: anexos que falharem ao baixar são
      // ignorados (com warn), o e-mail é enviado mesmo assim.
      if (dto.attachments && dto.attachments.length > 0) {
        const docs = await Promise.all(
          dto.attachments.map((docId) =>
            this.documentRepository.findOne({ id: docId }),
          ),
        );
        for (const doc of docs) {
          if (!doc?.uri) continue;
          if (doc.surgeryRequestId !== id) {
            this.logger.warn(
              `[sendRequest] anexo ${doc.id} ignorado: pertence a outra SC (${doc.surgeryRequestId})`,
            );
            continue;
          }
          try {
            const buffer = await this.storageService.download(doc.uri);
            if (!buffer) continue;
            const fileName =
              doc.name || doc.uri.split('/').pop() || `documento-${doc.id}`;
            mailAttachments.push({
              filename: fileName,
              content: buffer,
              contentType: 'application/octet-stream',
            });
          } catch (err) {
            this.logger.warn(
              `[sendRequest] Falha ao baixar anexo ${doc.id}: ${(err as Error)?.message}`,
            );
          }
        }
      }

      await this.mailService.sendSurgeryRequestSent(
        dto.to,
        {
          patientName,
          requestId: request.protocol ?? id,
          hospitalName,
          healthPlanName,
          doctorName,
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

    this.logger.log(`[sendRequest] Solicitação ${id} enviada com sucesso`);
    return { sent: true };
  }

  async startAnalysis(id: string, dto: StartAnalysisDto, userId: string) {
    this.logger.log(
      `[startAnalysis] Iniciando análise da solicitação ${id} por usuário ${userId}`,
    );
    const request = await this.surgeryRequestRepository.findOneWithAllRelations(
      { id },
    );
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    if (request.status !== SurgeryRequestStatus.SENT) {
      throw new BadRequestException(
        'A solicitação precisa estar com status Enviada.',
      );
    }
    await this.pendencyValidator.assertCanAdvance(id);

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const repo = manager.getRepository(SurgeryRequest);
        const analysisRepo = manager.getRepository(SurgeryRequestAnalysis);

        const receivedAt = parseCalendarDate(dto.receivedAt);

        await analysisRepo.save({
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

        await repo.update({ id }, { status: SurgeryRequestStatus.IN_ANALYSIS });
        await this.surgeryRequestRepository.recordStatusChange(
          manager,
          id,
          request.status,
          SurgeryRequestStatus.IN_ANALYSIS,
          userId,
          receivedAt,
        );
      },
      { logger: this.logger, operationName: 'startAnalysis' },
    );

    await this.notificationService.notifyStakeholdersOfStatusChange(
      request,
      SurgeryRequestStatus.SENT,
      SurgeryRequestStatus.IN_ANALYSIS,
      userId,
    );
    this.logger.log(`[startAnalysis] Solicitação ${id} movida para Em Análise`);
  }
}
