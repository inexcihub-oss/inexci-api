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
import { SurgeryRequestAnalysis } from 'src/database/entities/surgery-request-analysis.entity';
import { ReportSection } from 'src/database/entities/report-section.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SendMethod } from 'src/shared/constants/send-method';
import { MailService } from 'src/shared/mail/mail.service';
import { PdfGenerationService } from 'src/shared/pdf/pdf-generation.service';
import { SurgeryRequestStateMachine } from 'src/shared/state-machine/surgery-request-state-machine';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';

import { SurgeryRequestNotificationService } from '../surgery-request-notification.service';
import { SurgeryRequestPdfAssemblyService } from '../surgery-request-pdf-assembly.service';
import { SendRequestDto } from '../../dto/send-request.dto';
import { StartAnalysisDto } from '../../dto/start-analysis.dto';

@Injectable()
export class SendAnalysisHandler {
  private readonly logger = new Logger(SendAnalysisHandler.name);
  private readonly stateMachine = new SurgeryRequestStateMachine();

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly pdfGenerationService: PdfGenerationService,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    @InjectRepository(ReportSection)
    private readonly reportSectionRepository: Repository<ReportSection>,
    private readonly notificationService: SurgeryRequestNotificationService,
    private readonly pdfAssemblyService: SurgeryRequestPdfAssemblyService,
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

    const sectionCount = await this.reportSectionRepository.count({
      where: { surgery_request_id: id },
    });
    if (sectionCount === 0) {
      throw new BadRequestException(
        'É necessário ao menos uma seção no laudo para enviar a solicitação',
      );
    }

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const repo = manager.getRepository(SurgeryRequest);
        await repo.update(
          { id },
          {
            status: SurgeryRequestStatus.SENT,
            sent_at: new Date(),
            send_method: dto.method,
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

    await this.notificationService.notifyPatientIfRequested(
      request,
      SurgeryRequestStatus.PENDING,
      SurgeryRequestStatus.SENT,
      dto.notify_patient,
    );

    await this.notificationService.notifyAdminsOfWorkflowAction(
      userId,
      request.patient?.name ?? 'Paciente',
      request.protocol ?? id,
      'Solicitação enviada para análise',
      `/solicitacoes/${id}`,
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
        `Falha ao agendar geração de PDF para solicitação ${id}: ${err?.message}`,
      );
    }

    const doctorName = request.created_by?.name ?? 'Médico';
    const patientName = request.patient?.name ?? 'Paciente';
    const healthPlanName = request.health_plan?.name ?? '';
    const hospitalName = request.hospital?.name ?? '';

    if (dto.method === SendMethod.EMAIL && dto.to) {
      await this.mailService.sendSurgeryRequestSent(dto.to, {
        patientName,
        requestId: request.protocol ?? id,
        hospitalName,
        healthPlanName,
        doctorName,
      });
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

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const repo = manager.getRepository(SurgeryRequest);
        const analysisRepo = manager.getRepository(SurgeryRequestAnalysis);

        await analysisRepo.save({
          surgery_request_id: id,
          request_number: dto.request_number,
          received_at: new Date(dto.received_at),
          quotation_1_number: dto.quotation_1_number,
          quotation_1_received_at: dto.quotation_1_received_at
            ? new Date(dto.quotation_1_received_at)
            : null,
          quotation_2_number: dto.quotation_2_number,
          quotation_2_received_at: dto.quotation_2_received_at
            ? new Date(dto.quotation_2_received_at)
            : null,
          quotation_3_number: dto.quotation_3_number,
          quotation_3_received_at: dto.quotation_3_received_at
            ? new Date(dto.quotation_3_received_at)
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
        );
      },
      { logger: this.logger, operationName: 'startAnalysis' },
    );

    await this.notificationService.notifyPatientIfRequested(
      request,
      SurgeryRequestStatus.SENT,
      SurgeryRequestStatus.IN_ANALYSIS,
      dto.notify_patient,
    );

    await this.notificationService.notifyAdminsOfWorkflowAction(
      userId,
      request.patient?.name ?? 'Paciente',
      request.protocol ?? id,
      'Análise iniciada',
      `/solicitacoes/${id}`,
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
