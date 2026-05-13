import { FindOptionsWhere, In } from 'typeorm';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { FindManySurgeryRequestDto } from './dto/find-many.dto';
import { StorageService } from 'src/shared/storage/storage.service';
import { CreateSurgeryRequestDto } from './dto/create-surgery-request.dto';
import { CreateSurgeryRequestSimpleDto } from './dto/create-surgery-request-simple.dto';
import { UserRepository } from 'src/database/repositories/user.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestTussItemRepository } from 'src/database/repositories/surgery-request-tuss-item.repository';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { UpdateSurgeryRequestDto } from './dto/update-surgery-request.dto';
import { UpdateSurgeryRequestBasicDto } from './dto/update-surgery-request-basic.dto';
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
import { CreateReportSectionDto } from './dto/create-report-section.dto';
import { UpdateReportSectionDto } from './dto/update-report-section.dto';
import { ReorderReportSectionsDto } from './dto/reorder-report-sections.dto';
import {
  transformDocumentUrls,
  transformDoctorSignatureUrl,
} from 'src/shared/transformers/signed-url.transformer';
import { SurgeryRequestBilling } from 'src/database/entities/surgery-request-billing.entity';

// ── Sub-services ─────────────────────────────────────────────────────────────
import { SurgeryRequestWorkflowService } from './services/surgery-request-workflow.service';
import { SurgeryRequestReportService } from './services/surgery-request-report.service';
import { SurgeryRequestTemplateService } from './services/surgery-request-template.service';
import { SurgeryRequestMutationService } from './services/surgery-request-mutation.service';
import { SendMethod } from 'src/shared/constants/send-method';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';

@Injectable()
export class SurgeryRequestsService {
  private readonly logger = new Logger(SurgeryRequestsService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly accessControlService: AccessControlService,
    private readonly userRepository: UserRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly tussItemRepository: SurgeryRequestTussItemRepository,
    // ── Sub-services ───────────────────────────────────────────────────────
    private readonly mutationService: SurgeryRequestMutationService,
    private readonly workflowService: SurgeryRequestWorkflowService,
    private readonly reportService: SurgeryRequestReportService,
    private readonly templateService: SurgeryRequestTemplateService,
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
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);

    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length === 0) return { total: 0, records: [] };

    let where: FindOptionsWhere<SurgeryRequest> = { doctorId: In(doctorIds) };
    if (query.status) where = { ...where, status: In(query.status) };

    const [total, records] = await Promise.all([
      this.surgeryRequestRepository.total(where),
      this.surgeryRequestRepository.findMany(
        where,
        query.skip ?? 0,
        query.take ?? 20,
      ),
    ]);

    return { total, records };
  }

  async findOne(id: string, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);

    const where = await this.buildAccessWhere({ id }, userId);
    const surgeryRequest = await this.surgeryRequestRepository.findOne(where);
    if (!surgeryRequest)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);

    if (Array.isArray(surgeryRequest.documents)) {
      surgeryRequest.documents = await transformDocumentUrls(
        surgeryRequest.documents,
        this.storageService,
      );
    }
    if (surgeryRequest.doctor) {
      surgeryRequest.doctor = await transformDoctorSignatureUrl(
        surgeryRequest.doctor,
        this.storageService,
      );
    }

    return {
      ...surgeryRequest,
      receipt: this.buildReceipt(surgeryRequest.billing),
    };
  }

  async findOneSimple(id: string, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);

    const where = await this.buildAccessWhere({ id }, userId);
    const surgeryRequest =
      await this.surgeryRequestRepository.findOneSimple(where);
    if (!surgeryRequest)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
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
  // ITENS TUSS
  // ============================================================

  async addTussItem(
    surgeryRequestId: string,
    data: { tussCode: string; name: string; quantity: number },
    userId: string,
  ) {
    const where = await this.buildAccessWhere({ id: surgeryRequestId }, userId);
    const request = await this.surgeryRequestRepository.findOneSimple(where);
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);

    return this.tussItemRepository.create({
      surgeryRequestId,
      tussCode: data.tussCode,
      name: data.name,
      quantity: data.quantity,
    });
  }

  async updateTussItem(
    tussItemId: string,
    data: { tussCode?: string; name?: string; quantity?: number },
    userId: string,
  ) {
    const item = await this.tussItemRepository.findOne({ id: tussItemId });
    if (!item) throw new NotFoundException('Item TUSS não encontrado.');

    const where = await this.buildAccessWhere(
      { id: item.surgeryRequestId },
      userId,
    );
    const request = await this.surgeryRequestRepository.findOneSimple(where);
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);

    return this.tussItemRepository.update(tussItemId, data);
  }

  async removeTussItem(tussItemId: string, userId: string) {
    const item = await this.tussItemRepository.findOne({ id: tussItemId });
    if (!item) throw new NotFoundException('Item TUSS não encontrado.');

    const where = await this.buildAccessWhere(
      { id: item.surgeryRequestId },
      userId,
    );
    const request = await this.surgeryRequestRepository.findOneSimple(where);
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);

    return this.tussItemRepository.deleteById(tussItemId);
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
      crm: d.doctorProfile?.crm,
      crmState: d.doctorProfile?.crmState,
      specialty: d.doctorProfile?.specialty,
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

  notify(
    id: string,
    dto: {
      template: string;
      to?: string;
      channels?: { email?: boolean; whatsapp?: boolean };
    },
    userId: string,
  ) {
    return this.workflowService.notify(id, dto, userId);
  }

  send(data: { id: string }, userId: string) {
    return this.workflowService.sendRequest(
      data.id,
      { method: SendMethod.DOWNLOAD },
      userId,
    );
  }

  cancel(data: { id: string; reason?: string }, userId: string) {
    return this.workflowService.closeSurgeryRequest(
      data.id,
      { reason: data.reason },
      userId,
    );
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

  exportSurgeryRequestPdf(id: string, userId: string): Promise<Buffer> {
    return this.workflowService.exportSurgeryRequestPdf(id, userId);
  }

  // ============================================================
  // DELEGAÇÃO → TEMPLATE SERVICE
  // ============================================================

  createTemplate(dto: { name: string; templateData: object }, userId: string) {
    return this.templateService.createTemplate(dto, userId);
  }

  getTemplates(userId: string) {
    return this.templateService.getTemplates(userId);
  }

  deleteTemplate(id: string, userId: string) {
    return this.templateService.deleteTemplate(id, userId);
  }

  updateTemplate(
    id: string,
    dto: { name?: string; templateData?: object },
    userId: string,
  ) {
    return this.templateService.updateTemplate(id, dto, userId);
  }

  incrementTemplateUsage(id: string, userId: string) {
    return this.templateService.incrementUsage(id, userId);
  }

  // ── Helpers privados ────────────────────────────────────────────────────────

  private async buildAccessWhere(
    base: FindOptionsWhere<SurgeryRequest>,
    userId: string,
  ): Promise<FindOptionsWhere<SurgeryRequest>> {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length === 0) return base;
    return { ...base, doctorId: In(doctorIds) };
  }

  private buildReceipt(billing: SurgeryRequestBilling | null | undefined) {
    if (billing?.receivedValue == null) return null;
    return {
      receivedValue: Number(billing.receivedValue),
      receivedAt: billing.receivedAt,
      receiptNotes: billing.receiptNotes ?? null,
      is_contested: billing.contestedReceivedValue != null,
      contestedReceivedValue: billing.contestedReceivedValue
        ? Number(billing.contestedReceivedValue)
        : null,
      contestedReceivedAt: billing.contestedReceivedAt ?? null,
    };
  }
}
