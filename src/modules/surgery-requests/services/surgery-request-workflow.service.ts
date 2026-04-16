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
import { Contestation } from 'src/database/entities/contestation.entity';
import { StatusUpdate } from 'src/database/entities/status-update.entity';
import {
  SurgeryRequestActivity,
  ActivityType,
} from 'src/database/entities/surgery-request-activity.entity';
import { ReportSection } from 'src/database/entities/report-section.entity';

import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { MailService } from 'src/shared/mail/mail.service';
import { PdfGenerationService } from 'src/shared/pdf/pdf-generation.service';
import { SurgeryRequestStateMachine } from 'src/shared/state-machine/surgery-request-state-machine';

import { SurgeryRequestNotificationService } from './surgery-request-notification.service';
import { SurgeryRequestPdfAssemblyService } from './surgery-request-pdf-assembly.service';
import { SurgeryRequestBillingService } from './surgery-request-billing.service';
import { SendRequestDto } from '../dto/send-request.dto';
import { StartAnalysisDto } from '../dto/start-analysis.dto';
import { AcceptAuthorizationDto } from '../dto/accept-authorization.dto';
import { ContestAuthorizationDto } from '../dto/contest-authorization.dto';
import { ConfirmDateDto } from '../dto/confirm-date.dto';
import { UpdateDateOptionsDto } from '../dto/update-date-options.dto';
import { RescheduleDto } from '../dto/reschedule.dto';
import { MarkPerformedDto } from '../dto/mark-performed.dto';
import { InvoiceRequestDto } from '../dto/invoice-request.dto';
import { ConfirmReceiptDto } from '../dto/confirm-receipt.dto';
import { ContestPaymentDto } from '../dto/contest-payment.dto';
import { UpdateReceiptDto } from '../dto/update-receipt.dto';
import { CloseSurgeryRequestDto } from '../dto/close-surgery-request.dto';

import { getStatusLabel } from 'src/shared/utils';

@Injectable()
export class SurgeryRequestWorkflowService {
  private readonly logger = new Logger(SurgeryRequestWorkflowService.name);
  private readonly stateMachine = new SurgeryRequestStateMachine();

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly pdfGenerationService: PdfGenerationService,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    @InjectRepository(SurgeryRequestAnalysis)
    private readonly analysisRepository: Repository<SurgeryRequestAnalysis>,
    @InjectRepository(Contestation)
    private readonly contestationRepository: Repository<Contestation>,
    @InjectRepository(ReportSection)
    private readonly reportSectionRepository: Repository<ReportSection>,
    private readonly notificationService: SurgeryRequestNotificationService,
    private readonly pdfAssemblyService: SurgeryRequestPdfAssemblyService,
    private readonly billingService: SurgeryRequestBillingService,
  ) {}

  // ============================================================
  // HELPERS PRIVADOS
  // ============================================================

  /** Carrega solicitação com todas as relações necessárias para a state machine */
  private async loadRequestWithRelations(id: string): Promise<SurgeryRequest> {
    const request = await this.surgeryRequestRepository.findOneWithRelations(
      { id },
      [
        'created_by',
        'patient',
        'hospital',
        'health_plan',
        'tuss_items',
        'opme_items',
        'documents',
        'analysis',
        'billing',
        'contestations',
      ],
    );
    if (!request) throw new NotFoundException('Solicitação não encontrada');
    return request;
  }

  /** Registra mudança de status em status_updates e em activities */
  private async recordStatusChange(
    manager: any,
    surgeryRequestId: string,
    prevStatus: SurgeryRequestStatus,
    newStatus: SurgeryRequestStatus,
    userId: string | null = null,
  ): Promise<void> {
    const statusUpdateRepo = manager.getRepository(StatusUpdate);
    await statusUpdateRepo.save({
      surgery_request_id: surgeryRequestId,
      prev_status: prevStatus,
      new_status: newStatus,
    });

    const activityRepo = manager.getRepository(SurgeryRequestActivity);
    const prevLabel = getStatusLabel(prevStatus);
    const newLabel = getStatusLabel(newStatus);
    await activityRepo.save({
      surgery_request_id: surgeryRequestId,
      user_id: userId,
      type: ActivityType.STATUS_CHANGE,
      content: `Status alterado de "${prevLabel}" para "${newLabel}"`,
    });
  }

  // ============================================================
  // ENDPOINTS DE TRANSIÇÃO DE STATUS
  // ============================================================

  async sendRequest(id: string, dto: SendRequestDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    this.stateMachine.assertCanTransition(request, SurgeryRequestStatus.SENT);

    // Validar que existe ao menos uma seção no laudo
    const sectionCount = await this.reportSectionRepository.count({
      where: { surgery_request_id: id },
    });
    if (sectionCount === 0) {
      throw new BadRequestException(
        'É necessário ao menos uma seção no laudo para enviar a solicitação',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      await repo.update(
        { id },
        {
          status: SurgeryRequestStatus.SENT,
          sent_at: new Date(),
          send_method: dto.method,
        },
      );
      await this.recordStatusChange(
        manager,
        id,
        request.status,
        SurgeryRequestStatus.SENT,
        userId,
      );
    });

    // Notificar paciente se solicitado
    await this.notificationService.notifyPatientIfRequested(
      request,
      SurgeryRequestStatus.PENDING,
      SurgeryRequestStatus.SENT,
      dto.notify_patient,
    );

    // Gerar PDF assincronamente (fire-and-forget via Bull queue)
    this.pdfGenerationService.scheduleGeneration(id, userId);

    const doctorName = request.created_by?.name ?? 'Médico';
    const patientName = request.patient?.name ?? 'Paciente';
    const healthPlanName = request.health_plan?.name ?? '';
    const hospitalName = request.hospital?.name ?? '';

    if (dto.method === 'email' && dto.to) {
      await this.mailService.sendSurgeryRequestSent(dto.to, {
        patientName,
        requestId: request.protocol ?? id,
        hospitalName,
        healthPlanName,
        doctorName,
      });
      return { sent: true, method: 'email' };
    }

    if (dto.method === 'download') {
      return this.pdfAssemblyService.generateLaudoPdf(request, userId);
    }

    return { sent: true };
  }

  async startAnalysis(id: string, dto: StartAnalysisDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    if (request.status !== SurgeryRequestStatus.SENT) {
      throw new BadRequestException(
        'A solicitação precisa estar com status Enviada.',
      );
    }

    await this.dataSource.transaction(async (manager) => {
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
      await this.recordStatusChange(
        manager,
        id,
        request.status,
        SurgeryRequestStatus.IN_ANALYSIS,
        userId,
      );
    });

    await this.notificationService.notifyPatientIfRequested(
      request,
      SurgeryRequestStatus.SENT,
      SurgeryRequestStatus.IN_ANALYSIS,
      dto.notify_patient,
    );
  }

  async acceptAuthorization(
    id: string,
    dto: AcceptAuthorizationDto,
    userId: string,
  ) {
    const request = await this.loadRequestWithRelations(id);
    this.stateMachine.assertCanTransition(
      request,
      SurgeryRequestStatus.IN_SCHEDULING,
    );

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      const contestRepo = manager.getRepository(Contestation);

      await contestRepo.update(
        {
          surgery_request_id: id,
          type: 'authorization',
          resolved_at: null as any,
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
      await this.recordStatusChange(
        manager,
        id,
        request.status,
        SurgeryRequestStatus.IN_SCHEDULING,
        userId,
      );
    });

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
    const request = await this.loadRequestWithRelations(id);
    if (request.status !== SurgeryRequestStatus.IN_ANALYSIS) {
      throw new BadRequestException(
        'A solicitação precisa estar Em Análise para ser contestada.',
      );
    }

    await this.contestationRepository.save({
      surgery_request_id: id,
      created_by_id: userId,
      type: 'authorization',
      reason: dto.reason,
    });

    const patientName = request.patient?.name ?? 'Paciente';
    const requestId = request.protocol ?? id;

    if (dto.method === 'email' && dto.to) {
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
      return { sent: true, method: 'email' };
    }

    return { sent: false, method: 'document' };
  }

  async generateContestAuthorizationPdf(
    id: string,
    userId: string,
  ): Promise<Buffer> {
    const request = await this.loadRequestWithRelations(id);
    return this.pdfAssemblyService.generateContestAuthorizationPdf(
      request,
      id,
      userId,
    );
  }

  async confirmDate(id: string, dto: ConfirmDateDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    if (request.status !== SurgeryRequestStatus.IN_SCHEDULING) {
      throw new BadRequestException(
        'A solicitação precisa estar Em Agendamento.',
      );
    }

    const dateOptions = request.date_options as string[];
    if (!dateOptions || dateOptions[dto.selected_date_index] === undefined) {
      throw new BadRequestException('Índice de data inválido.');
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      await repo.update(
        { id },
        {
          status: SurgeryRequestStatus.SCHEDULED,
          selected_date_index: dto.selected_date_index,
          surgery_date: new Date(dateOptions[dto.selected_date_index]),
        },
      );
      await this.recordStatusChange(
        manager,
        id,
        request.status,
        SurgeryRequestStatus.SCHEDULED,
        userId,
      );
    });

    await this.notificationService.notifyPatientIfRequested(
      request,
      request.status,
      SurgeryRequestStatus.SCHEDULED,
      dto.notify_patient,
    );
  }

  async updateDateOptions(
    id: string,
    dto: UpdateDateOptionsDto,
    userId: string,
  ) {
    const request = await this.surgeryRequestRepository.findOneSimple({ id });
    if (!request) throw new NotFoundException('Solicitação não encontrada');
    if (request.status !== SurgeryRequestStatus.IN_SCHEDULING) {
      throw new BadRequestException(
        'A solicitação precisa estar Em Agendamento para atualizar datas.',
      );
    }

    await this.surgeryRequestRepository.update(id, {
      date_options: dto.date_options,
    });
  }

  async reschedule(id: string, dto: RescheduleDto, userId: string) {
    const request = await this.surgeryRequestRepository.findOneSimple({ id });
    if (!request) throw new NotFoundException('Solicitação não encontrada');
    if (request.status !== SurgeryRequestStatus.SCHEDULED) {
      throw new BadRequestException(
        'A solicitação precisa estar Agendada para reagendar.',
      );
    }

    await this.surgeryRequestRepository.update(id, {
      surgery_date: new Date(dto.new_date),
    });
  }

  async markPerformed(id: string, dto: MarkPerformedDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    this.stateMachine.assertCanTransition(
      request,
      SurgeryRequestStatus.PERFORMED,
    );

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      await repo.update(
        { id },
        {
          status: SurgeryRequestStatus.PERFORMED,
          surgery_performed_at: new Date(dto.surgery_performed_at),
        },
      );
      await this.recordStatusChange(
        manager,
        id,
        request.status,
        SurgeryRequestStatus.PERFORMED,
        userId,
      );
    });

    await this.notificationService.notifyPatientIfRequested(
      request,
      request.status,
      SurgeryRequestStatus.PERFORMED,
      dto.notify_patient,
    );
  }

  // ============================================================
  // BILLING (delegado para SurgeryRequestBillingService)
  // ============================================================

  async invoiceRequest(id: string, dto: InvoiceRequestDto, userId: string) {
    return this.billingService.invoiceRequest(id, dto, userId);
  }

  async confirmReceipt(id: string, dto: ConfirmReceiptDto, userId: string) {
    return this.billingService.confirmReceipt(id, dto, userId);
  }

  async contestPayment(id: string, dto: ContestPaymentDto, userId: string) {
    return this.billingService.contestPayment(id, dto, userId);
  }

  async updateReceipt(id: string, dto: UpdateReceiptDto, userId: string) {
    return this.billingService.updateReceipt(id, dto, userId);
  }

  async closeSurgeryRequest(
    id: string,
    dto: CloseSurgeryRequestDto,
    userId: string,
  ) {
    const request = await this.surgeryRequestRepository.findOneSimple({ id });
    if (!request) throw new NotFoundException('Solicitação não encontrada');

    this.stateMachine.assertCanTransition(
      request as any,
      SurgeryRequestStatus.CLOSED,
    );

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      await repo.update(
        { id },
        {
          status: SurgeryRequestStatus.CLOSED,
          closed_at: new Date(),
          cancel_reason: dto.reason,
        },
      );
      await this.recordStatusChange(
        manager,
        id,
        request.status as SurgeryRequestStatus,
        SurgeryRequestStatus.CLOSED,
        userId,
      );
    });
  }

  async notify(
    id: string,
    dto: { template: string; to?: string },
    userId: string,
  ) {
    return this.notificationService.notify(id, dto, userId);
  }
}
