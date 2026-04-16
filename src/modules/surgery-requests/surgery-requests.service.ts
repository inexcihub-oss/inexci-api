import { FindOptionsWhere, In, Repository } from 'typeorm';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { UsersService } from '../users/users.service';
import { FindManySurgeryRequestDto } from './dto/find-many.dto';
import { StorageService } from 'src/shared/storage/storage.service';
import { CreateSurgeryRequestDto } from './dto/create-surgery-request.dto';
import { CreateSurgeryRequestSimpleDto } from './dto/create-surgery-request-simple.dto';
import { UserRepository } from 'src/database/repositories/user.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestQuotationRepository } from 'src/database/repositories/surgery-request-quotation.repository';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestAnalysis } from 'src/database/entities/surgery-request-analysis.entity';
import { SurgeryRequestBilling } from 'src/database/entities/surgery-request-billing.entity';
import { Contestation } from 'src/database/entities/contestation.entity';
import { UpdateSurgeryRequestDto } from './dto/update-surgery-request.dto';
import { UpdateSurgeryRequestBasicDto } from './dto/update-surgery-request-basic.dto';
import { PendencyValidatorService } from './pendencies/pendency-validator.service';
import { AccessControlService } from 'src/shared/services/access-control.service';

// ── DTOs de transição ────────────────────────────────────────────────────────
import { SendRequestDto } from './dto/send-request.dto';
import { StartAnalysisDto } from './dto/start-analysis.dto';
import { AcceptAuthorizationDto } from './dto/accept-authorization.dto';
import { ContestAuthorizationDto } from './dto/contest-authorization.dto';
import { ConfirmDateDto } from './dto/confirm-date.dto';
import { UpdateDateOptionsDto } from './dto/update-date-options.dto';
import { RescheduleDto } from './dto/reschedule.dto';
import { MarkPerformedDto } from './dto/mark-performed.dto';
import { InvoiceRequestDto } from './dto/invoice-request.dto';
import { ConfirmReceiptDto } from './dto/confirm-receipt.dto';
import { ContestPaymentDto } from './dto/contest-payment.dto';
import { UpdateReceiptDto } from './dto/update-receipt.dto';
import { CloseSurgeryRequestDto } from './dto/close-surgery-request.dto';
import { ReportSection } from 'src/database/entities/report-section.entity';
import { CreateReportSectionDto } from './dto/create-report-section.dto';
import { UpdateReportSectionDto } from './dto/update-report-section.dto';
import { ReorderReportSectionsDto } from './dto/reorder-report-sections.dto';

// ── Sub-services ─────────────────────────────────────────────────────────────
import { SurgeryRequestWorkflowService } from './services/surgery-request-workflow.service';
import { SurgeryRequestReportService } from './services/surgery-request-report.service';
import { SurgeryRequestTemplateService } from './services/surgery-request-template.service';
import { SurgeryRequestMutationService } from './services/surgery-request-mutation.service';
import { SurgeryRequestLegacyService } from './services/surgery-request-legacy.service';

@Injectable()
export class SurgeryRequestsService {
  private readonly logger = new Logger(SurgeryRequestsService.name);

  constructor(
    private readonly pendencyValidatorService: PendencyValidatorService,
    private readonly userService: UsersService,
    private readonly storageService: StorageService,
    private readonly accessControlService: AccessControlService,
    private readonly userRepository: UserRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly surgeryRequestQuotationRepository: SurgeryRequestQuotationRepository,
    @InjectRepository(SurgeryRequestAnalysis)
    private readonly analysisRepository: Repository<SurgeryRequestAnalysis>,
    @InjectRepository(SurgeryRequestBilling)
    private readonly billingRepository: Repository<SurgeryRequestBilling>,
    @InjectRepository(Contestation)
    private readonly contestationRepository: Repository<Contestation>,
    @InjectRepository(ReportSection)
    private readonly reportSectionRepository: Repository<ReportSection>,
    // ── Sub-services ───────────────────────────────────────────────────────
    private readonly mutationService: SurgeryRequestMutationService,
    private readonly workflowService: SurgeryRequestWorkflowService,
    private readonly reportService: SurgeryRequestReportService,
    private readonly templateService: SurgeryRequestTemplateService,
    private readonly legacyService: SurgeryRequestLegacyService,
  ) {}

  // ============================================================
  // CRIAÇÃO — delega para MutationService
  // ============================================================

  create(data: CreateSurgeryRequestDto, userId: string) {
    return this.mutationService.create(data, userId);
  }

  createSurgeryRequest(data: CreateSurgeryRequestSimpleDto, userId: string) {
    return this.mutationService.createSurgeryRequest(data, userId);
  }

  // ============================================================
  // LEITURA
  // ============================================================

  async findAll(query: FindManySurgeryRequestDto, userId: string) {
    let where: FindOptionsWhere<SurgeryRequest> = {};
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    if (query.status) {
      where = { ...where, status: In(query.status) };
    }

    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length === 0) {
      return { total: 0, records: [] };
    }
    where = { ...where, doctor_id: In(doctorIds) };

    const [total, records] = await Promise.all([
      this.surgeryRequestRepository.total(where),
      this.surgeryRequestRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }

  async findOne(id: string, userId: string) {
    let where: FindOptionsWhere<SurgeryRequest> = { id };
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length > 0) {
      where = { ...where, doctor_id: In(doctorIds) };
    }

    const surgeryRequest = await this.surgeryRequestRepository.findOne(where);
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');

    // Computar campo `receipt` derivado de `billing`
    const billing = (surgeryRequest as any).billing;
    const receipt =
      billing?.received_value != null
        ? {
            received_value: Number(billing.received_value),
            received_at: billing.received_at,
            receipt_notes: billing.receipt_notes ?? null,
            is_contested: billing.contested_received_value != null,
            contested_received_value: billing.contested_received_value
              ? Number(billing.contested_received_value)
              : null,
            contested_received_at: billing.contested_received_at ?? null,
          }
        : null;

    // Converter uri dos documentos para URL pública do Supabase
    const rawRequest = surgeryRequest as any;
    if (Array.isArray(rawRequest.documents)) {
      rawRequest.documents = await Promise.all(
        rawRequest.documents.map(async (doc: any) => {
          try {
            return {
              ...doc,
              path: doc.uri,
              uri: await this.storageService.getSignedUrl(doc.uri),
            };
          } catch {
            return doc;
          }
        }),
      );
    }

    // Converter signature_url do médico para URL pública do Supabase
    if (
      rawRequest.doctor?.signature_url &&
      !rawRequest.doctor.signature_url.startsWith('http')
    ) {
      try {
        rawRequest.doctor = {
          ...rawRequest.doctor,
          signature_url: await this.storageService.getSignedUrl(
            rawRequest.doctor.signature_url,
          ),
        };
      } catch {
        // mantém o path original em caso de erro
      }
    }

    return { ...rawRequest, receipt };
  }

  async findOneSimple(id: string, userId: string) {
    let where: FindOptionsWhere<SurgeryRequest> = { id };
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length > 0) {
      where = { ...where, doctor_id: In(doctorIds) };
    }

    const surgeryRequest =
      await this.surgeryRequestRepository.findOneSimple(where);
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');
    return surgeryRequest;
  }

  // ============================================================
  // ATUALIZAÇÃO — delega para MutationService
  // ============================================================

  update(data: UpdateSurgeryRequestDto, userId: string) {
    return this.mutationService.update(data, userId);
  }

  updateBasic(data: UpdateSurgeryRequestBasicDto, userId: string) {
    return this.mutationService.updateBasic(data, userId);
  }

  setHasOpme(id: string, hasOpme: boolean, userId: string) {
    return this.mutationService.setHasOpme(id, hasOpme, userId);
  }

  // ============================================================
  // MÉDICOS DISPONÍVEIS PARA CRIAÇÃO
  // ============================================================

  async getAvailableDoctors(userId: string) {
    const doctors =
      await this.accessControlService.getAvailableDoctorsForCreation(userId);
    return doctors.map((d) => ({
      id: d.id,
      name: d.name,
      crm: d.doctor_profile?.crm,
      crm_state: d.doctor_profile?.crm_state,
      specialty: d.doctor_profile?.specialty,
    }));
  }

  // ============================================================
  // DELEGAÇÃO → WORKFLOW SERVICE
  // ============================================================

  sendRequest(id: string, dto: SendRequestDto, userId: string) {
    return this.workflowService.sendRequest(id, dto, userId);
  }

  startAnalysis(id: string, dto: StartAnalysisDto, userId: string) {
    return this.workflowService.startAnalysis(id, dto, userId);
  }

  acceptAuthorization(id: string, dto: AcceptAuthorizationDto, userId: string) {
    return this.workflowService.acceptAuthorization(id, dto, userId);
  }

  contestAuthorization(
    id: string,
    dto: ContestAuthorizationDto,
    userId: string,
  ) {
    return this.workflowService.contestAuthorization(id, dto, userId);
  }

  generateContestAuthorizationPdf(id: string, userId: string) {
    return this.workflowService.generateContestAuthorizationPdf(id, userId);
  }

  confirmDate(id: string, dto: ConfirmDateDto, userId: string) {
    return this.workflowService.confirmDate(id, dto, userId);
  }

  updateDateOptions(id: string, dto: UpdateDateOptionsDto, userId: string) {
    return this.workflowService.updateDateOptions(id, dto, userId);
  }

  reschedule(id: string, dto: RescheduleDto, userId: string) {
    return this.workflowService.reschedule(id, dto, userId);
  }

  markPerformed(id: string, dto: MarkPerformedDto, userId: string) {
    return this.workflowService.markPerformed(id, dto, userId);
  }

  invoiceRequest(id: string, dto: InvoiceRequestDto, userId: string) {
    return this.workflowService.invoiceRequest(id, dto, userId);
  }

  confirmReceipt(id: string, dto: ConfirmReceiptDto, userId: string) {
    return this.workflowService.confirmReceipt(id, dto, userId);
  }

  contestPayment(id: string, dto: ContestPaymentDto, userId: string) {
    return this.workflowService.contestPayment(id, dto, userId);
  }

  updateReceipt(id: string, dto: UpdateReceiptDto, userId: string) {
    return this.workflowService.updateReceipt(id, dto, userId);
  }

  closeSurgeryRequest(id: string, dto: CloseSurgeryRequestDto, userId: string) {
    return this.workflowService.closeSurgeryRequest(id, dto, userId);
  }

  notify(id: string, dto: { template: string; to?: string }, userId: string) {
    return this.workflowService.notify(id, dto, userId);
  }

  send(data: any, userId: string) {
    return this.workflowService.sendRequest(
      data.id,
      { method: 'download' },
      userId,
    );
  }

  cancel(data: any, userId: string) {
    return this.workflowService.closeSurgeryRequest(
      data.id,
      { reason: data.reason },
      userId,
    );
  }

  updateStatus(
    surgeryRequestId: string,
    newStatus: number,
    userId: string,
    notifyPatient?: boolean,
  ) {
    return this.legacyService.updateStatus(
      surgeryRequestId,
      newStatus,
      userId,
      notifyPatient,
    );
  }

  dateExpired() {
    return this.legacyService.dateExpired();
  }

  // ============================================================
  // DELEGAÇÃO → REPORT SERVICE
  // ============================================================

  getReportSections(id: string, userId: string) {
    return this.reportService.getReportSections(id, userId);
  }

  createReportSection(id: string, dto: CreateReportSectionDto, userId: string) {
    return this.reportService.createReportSection(id, dto, userId);
  }

  updateReportSection(
    id: string,
    sectionId: string,
    dto: UpdateReportSectionDto,
    userId: string,
  ) {
    return this.reportService.updateReportSection(id, sectionId, dto, userId);
  }

  deleteReportSection(id: string, sectionId: string, userId: string) {
    return this.reportService.deleteReportSection(id, sectionId, userId);
  }

  reorderReportSections(
    id: string,
    dto: ReorderReportSectionsDto,
    userId: string,
  ) {
    return this.reportService.reorderReportSections(id, dto, userId);
  }

  generateReportPdf(id: string, userId: string) {
    return this.reportService.generateReportPdf(id, userId);
  }

  // ============================================================
  // DELEGAÇÃO → TEMPLATE SERVICE
  // ============================================================

  createTemplate(dto: { name: string; template_data: object }, userId: string) {
    return this.templateService.createTemplate(dto, userId);
  }

  getTemplates(userId: string) {
    return this.templateService.getTemplates(userId);
  }

  deleteTemplate(id: string, userId: string) {
    return this.templateService.deleteTemplate(id, userId);
  }
}
