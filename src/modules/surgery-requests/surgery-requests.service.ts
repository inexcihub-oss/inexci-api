import { Between, FindOptionsWhere, In } from 'typeorm';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Permission } from 'src/shared/permissions';

import { FindManySurgeryRequestDto } from './dto/find-many.dto';
import { FindManyKanbanDto, KANBAN_MAX_TAKE } from './dto/find-many-kanban.dto';
import { AGENDA_MAX_TAKE, FindAgendaDto } from './dto/find-agenda.dto';
import {
  mapDetailDoctor,
  mapSurgeryRequestDetail,
  type SurgeryRequestDetailInput,
} from './mappers/surgery-request-detail.mapper';
import { PendencyValidatorService } from './pendencies/pendency-validator.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { CreateSurgeryRequestDto } from './dto/create-surgery-request.dto';
import { CreateSurgeryRequestSimpleDto } from './dto/create-surgery-request-simple.dto';
import { UserRepository } from 'src/database/repositories/user.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestTussItemRepository } from 'src/database/repositories/surgery-request-tuss-item.repository';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { UpdateSurgeryRequestDto } from './dto/update-surgery-request.dto';
import { UpdateSurgeryRequestBasicDto } from './dto/update-surgery-request-basic.dto';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { withActiveSpan } from 'src/shared/observability/span.util';
import { trace } from '@opentelemetry/api';

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
import { UserDoctorAccessRepository } from 'src/database/repositories/user-doctor-access.repository';

// ── Sub-services ─────────────────────────────────────────────────────────────
import { SurgeryRequestWorkflowService } from './services/surgery-request-workflow.service';
import { SurgeryRequestReportService } from './services/surgery-request-report.service';
import { SurgeryRequestTemplateService } from './services/surgery-request-template.service';
import { SurgeryRequestMutationService } from './services/surgery-request-mutation.service';
import { SurgeryRequestRealtimeService } from './realtime/surgery-request-realtime.service';
import { SendMethod } from 'src/shared/constants/send-method';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';
import { CidService } from './cid/cid.service';

@Injectable()
export class SurgeryRequestsService {
  private readonly logger = new Logger(SurgeryRequestsService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly accessControlService: AccessControlService,
    private readonly userRepository: UserRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly tussItemRepository: SurgeryRequestTussItemRepository,
    private readonly opmeItemRepository: OpmeItemRepository,
    private readonly userDoctorAccessRepository: UserDoctorAccessRepository,
    private readonly pendencyValidatorService: PendencyValidatorService,
    // ── Sub-services ───────────────────────────────────────────────────────
    private readonly mutationService: SurgeryRequestMutationService,
    private readonly workflowService: SurgeryRequestWorkflowService,
    private readonly reportService: SurgeryRequestReportService,
    private readonly templateService: SurgeryRequestTemplateService,
    private readonly realtimeService: SurgeryRequestRealtimeService,
    private readonly cidService: CidService,
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

  async findAll(
    query: FindManySurgeryRequestDto,
    userId: string,
    userPermissions: Permission[],
  ) {
    // Ponte deliberada: o controller abre o método para SOLICITACOES OU
    // ATENDIMENTO (guard só sabe fazer "OU"). Quem chegou sem SOLICITACOES
    // só pode consultar as cirurgias de um paciente específico que está
    // atendendo — nunca navegar a carteira cirúrgica inteira da clínica.
    if (
      !userPermissions.includes(Permission.SOLICITACOES) &&
      !query.patientId
    ) {
      throw new ForbiddenException(
        'Informe o paciente (patientId) para consultar as cirurgias dele — sem a permissão de Solicitações não é possível listar a carteira cirúrgica completa.',
      );
    }

    // O JwtAuthGuard já validou a existência do usuário; getAccessibleDoctorIds
    // retorna [] para usuário inexistente. Sem findOne redundante (P9).
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length === 0) return { total: 0, records: [] };

    let where: FindOptionsWhere<SurgeryRequest> = { doctorId: In(doctorIds) };
    if (query.status) where = { ...where, status: In(query.status) };
    if (query.patientId) where = { ...where, patientId: query.patientId };
    if (query.hospitalId) where = { ...where, hospitalId: query.hospitalId };
    if (query.healthPlanId) {
      where = { ...where, healthPlanId: query.healthPlanId };
    }
    // O filtro por médico só estreita o escopo já autorizado: um médico fora
    // dos acessíveis nunca vira uma consulta ampliada, vira lista vazia.
    if (query.doctorId) {
      if (!doctorIds.includes(query.doctorId)) return { total: 0, records: [] };
      where = { ...where, doctorId: query.doctorId };
    }

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

  /**
   * Listagem enxuta para o kanban (P8). Diferente de `findAll`:
   * - Retorna apenas os campos consumidos pelos cards (sem relações pesadas).
   * - Já embute os contadores de pendência REAIS (via
   *   `PendencyValidatorService.getBatchSummary`, carga em lote com
   *   `relationLoadStrategy: 'query'`), eliminando o segundo round-trip que o
   *   frontend fazia ao endpoint `batch-summary` (P4).
   * - Carrega todos os cards do tenant de uma vez (teto `KANBAN_MAX_TAKE`),
   *   corrigindo o bug histórico do `take = 20`.
   */
  async findAllForKanban(query: FindManyKanbanDto, userId: string) {
    return withActiveSpan(
      'surgeryRequest.kanban',
      {
        'user.id': userId,
        ...(query.status?.length && {
          'surgeryRequest.statusFilter': query.status.join(','),
        }),
      },
      async () => {
        const doctorIds =
          await this.accessControlService.getAccessibleDoctorIds(userId);
        if (doctorIds.length === 0) return { total: 0, records: [] };

        let where: FindOptionsWhere<SurgeryRequest> = {
          doctorId: In(doctorIds),
        };
        if (query.status) where = { ...where, status: In(query.status) };

        const take = query.take ?? KANBAN_MAX_TAKE;
        const skip = query.skip ?? 0;

        const [total, records] = await Promise.all([
          this.surgeryRequestRepository.total(where),
          this.surgeryRequestRepository.findMany(where, skip, take),
        ]);

        const ids = records.map((record) => String(record.id));
        const ownerId = await this.accessControlService.getOwnerId(userId);
        const summaries = ids.length
          ? await this.pendencyValidatorService.getBatchSummary(
              ids.join(','),
              ownerId,
            )
          : {};

        const cards = records.map((record) =>
          this.toKanbanCard(record, summaries[String(record.id)]),
        );

        return { total, records: cards };
      },
    );
  }

  private toKanbanCard(
    record: SurgeryRequest & {
      pendenciesCount: number;
      totalPendencies: number;
      hasIncompletePayment: boolean;
    },
    summary?: { pending: number; total: number; canAdvance: boolean },
    suppliers?: string | null,
  ) {
    const ref = (
      entity?: { id: string; name: string } | null,
    ): { id: string; name: string } | null =>
      entity ? { id: entity.id, name: entity.name } : null;

    return {
      id: record.id,
      status: record.status,
      protocol: record.protocol ?? null,
      priority: record.priority,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastStatusChangedAt: record.lastStatusChangedAt ?? null,
      surgeryDate: record.surgeryDate ?? null,
      isIndication: record.isIndication ?? false,
      indicationName: record.indicationName ?? null,
      patient: ref(record.patient),
      doctor: ref(record.doctor),
      healthPlan: ref(record.healthPlan),
      procedure: ref(record.procedure),
      pendenciesCount: summary?.pending ?? record.pendenciesCount,
      totalPendencies: summary?.total ?? record.totalPendencies,
      canAdvance: summary?.canAdvance ?? true,
      hasIncompletePayment: record.hasIncompletePayment,
      suppliers: suppliers ?? null,
    };
  }

  /**
   * Agenda por intervalo de `surgeryDate` (P7/P8). Substitui o antigo
   * `status=5,6,7,8` (que trazia todas as cirurgias agendadas): consulta apenas
   * as cirurgias com data dentro do período visível. Cards enxutos (mesmo
   * formato do kanban) — a agenda não usa contadores de pendência.
   */
  async findAgenda(query: FindAgendaDto, userId: string) {
    return withActiveSpan(
      'surgeryRequest.agenda',
      { 'user.id': userId, 'date.from': query.from, 'date.to': query.to },
      async () => {
        const doctorIds =
          await this.accessControlService.getAccessibleDoctorIds(userId);
        if (doctorIds.length === 0) return { total: 0, records: [] };

        const from = new Date(query.from);
        const to = new Date(query.to);

        const where: FindOptionsWhere<SurgeryRequest> = {
          doctorId: In(doctorIds),
          surgeryDate: Between(from, to),
        };

        const [total, records] = await Promise.all([
          this.surgeryRequestRepository.total(where),
          this.surgeryRequestRepository.findMany(where, 0, AGENDA_MAX_TAKE),
        ]);

        const supplierRows =
          await this.opmeItemRepository.findSelectedSuppliersByRequestIds(
            records.map((record) => String(record.id)),
          );
        const suppliersById = new Map<string, string[]>();
        for (const row of supplierRows) {
          const list = suppliersById.get(row.surgeryRequestId) ?? [];
          if (!list.includes(row.supplierName)) list.push(row.supplierName);
          suppliersById.set(row.surgeryRequestId, list);
        }

        return {
          total,
          records: records.map((record) =>
            this.toKanbanCard(
              record,
              undefined,
              suppliersById.get(String(record.id))?.join(', ') ?? null,
            ),
          ),
        };
      },
    );
  }

  async findOne(id: string, userId: string) {
    return withActiveSpan(
      'surgeryRequest.findDetail',
      { 'surgeryRequest.id': id, 'user.id': userId },
      async () => {
        // JwtAuthGuard já validou o usuário; buildAccessWhere restringe por acesso (P9).
        const where = await this.buildAccessWhere({ id }, userId);
        const surgeryRequest =
          await this.surgeryRequestRepository.findOne(where);
        if (!surgeryRequest)
          throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);

        trace
          .getActiveSpan()
          ?.setAttribute('surgeryRequest.status', surgeryRequest.status);
        trace
          .getActiveSpan()
          ?.setAttribute('tenantId', surgeryRequest.ownerId ?? '');

        if (Array.isArray(surgeryRequest.documents)) {
          surgeryRequest.documents = await transformDocumentUrls(
            surgeryRequest.documents,
            this.storageService,
          );
        }
        let doctor = surgeryRequest.doctor;
        if (doctor) {
          doctor = await transformDoctorSignatureUrl(
            doctor,
            this.storageService,
          );
        }

        const resolvedCid = surgeryRequest.cidCode
          ? this.cidService.findByExactCode(surgeryRequest.cidCode)
          : null;

        // Resposta explícita (P11 / item 3.6): DTO por relação em vez de spread da entidade.
        return mapSurgeryRequestDetail(
          surgeryRequest as SurgeryRequestDetailInput,
          mapDetailDoctor(doctor),
          this.buildReceipt(surgeryRequest.billing),
          resolvedCid,
        );
      },
    );
  }

  async findOneSimple(id: string, userId: string) {
    // JwtAuthGuard já validou o usuário; buildAccessWhere restringe por acesso (P9).
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

  async sendRequest(id: string, dto: SendRequestDto, userId: string) {
    const result = await this.workflowService.sendRequest(id, dto, userId);
    await this.realtimeService.broadcastChange(id, 'status-updated', userId);
    return result;
  }

  async startAnalysis(id: string, dto: StartAnalysisDto, userId: string) {
    const result = await this.workflowService.startAnalysis(id, dto, userId);
    await this.realtimeService.broadcastChange(id, 'status-updated', userId);
    return result;
  }

  async acceptAuthorization(
    id: string,
    dto: AcceptAuthorizationDto,
    userId: string,
  ) {
    const result = await this.workflowService.acceptAuthorization(
      id,
      dto,
      userId,
    );
    await this.realtimeService.broadcastChange(id, 'status-updated', userId);
    return result;
  }

  async contestAuthorization(
    id: string,
    dto: ContestAuthorizationDto,
    userId: string,
  ) {
    const result = await this.workflowService.contestAuthorization(
      id,
      dto,
      userId,
    );
    await this.realtimeService.broadcastChange(id, 'updated', userId);
    return result;
  }

  generateContestAuthorizationPdf(id: string, userId: string) {
    return this.workflowService.generateContestAuthorizationPdf(id, userId);
  }

  async confirmDate(id: string, dto: ConfirmDateDto, userId: string) {
    const result = await this.workflowService.confirmDate(id, dto, userId);
    await this.realtimeService.broadcastChange(id, 'status-updated', userId);
    return result;
  }

  async updateDateOptions(
    id: string,
    dto: UpdateDateOptionsDto,
    userId: string,
  ) {
    const result = await this.workflowService.updateDateOptions(
      id,
      dto,
      userId,
    );
    await this.realtimeService.broadcastChange(id, 'updated', userId);
    return result;
  }

  async reschedule(id: string, dto: RescheduleDto, userId: string) {
    const result = await this.workflowService.reschedule(id, dto, userId);
    await this.realtimeService.broadcastChange(id, 'updated', userId);
    return result;
  }

  async markPerformed(id: string, dto: MarkPerformedDto, userId: string) {
    const result = await this.workflowService.markPerformed(id, dto, userId);
    await this.realtimeService.broadcastChange(id, 'status-updated', userId);
    return result;
  }

  async invoiceRequest(id: string, dto: InvoiceRequestDto, userId: string) {
    const result = await this.workflowService.invoiceRequest(id, dto, userId);
    await this.realtimeService.broadcastChange(id, 'status-updated', userId);
    return result;
  }

  async confirmReceipt(id: string, dto: ConfirmReceiptDto, userId: string) {
    const result = await this.workflowService.confirmReceipt(id, dto, userId);
    await this.realtimeService.broadcastChange(id, 'status-updated', userId);
    return result;
  }

  async contestPayment(id: string, dto: ContestPaymentDto, userId: string) {
    const result = await this.workflowService.contestPayment(id, dto, userId);
    await this.realtimeService.broadcastChange(id, 'updated', userId);
    return result;
  }

  async updateReceipt(id: string, dto: UpdateReceiptDto, userId: string) {
    const result = await this.workflowService.updateReceipt(id, dto, userId);
    await this.realtimeService.broadcastChange(id, 'updated', userId);
    return result;
  }

  async closeSurgeryRequest(
    id: string,
    dto: CloseSurgeryRequestDto,
    userId: string,
  ) {
    const result = await this.workflowService.closeSurgeryRequest(
      id,
      dto,
      userId,
    );
    await this.realtimeService.broadcastChange(id, 'status-updated', userId);
    return result;
  }

  notify(
    id: string,
    dto: {
      template: string;
      to?: string;
      channels?: { email?: boolean; whatsapp?: boolean };
      oldStatus?: number;
    },
    userId: string,
  ) {
    return this.workflowService.notify(id, dto, userId);
  }

  async send(data: { id: string }, userId: string) {
    const result = await this.workflowService.sendRequest(
      data.id,
      { method: SendMethod.DOWNLOAD },
      userId,
    );
    await this.realtimeService.broadcastChange(
      data.id,
      'status-updated',
      userId,
    );
    return result;
  }

  async cancel(data: { id: string; reason?: string }, userId: string) {
    const result = await this.workflowService.closeSurgeryRequest(
      data.id,
      { reason: data.reason },
      userId,
    );
    await this.realtimeService.broadcastChange(
      data.id,
      'status-updated',
      userId,
    );
    return result;
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

  upsertReportSectionByTitle(
    id: string,
    title: string,
    description: string,
  ): Promise<void> {
    return this.reportService.upsertReportSectionByTitle(
      id,
      title,
      description,
    );
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

  generateMedicalReportPdf(id: string, userId: string) {
    return this.reportService.generateMedicalReportPdf(id, userId);
  }

  exportSurgeryRequestPdf(id: string, userId: string): Promise<Buffer> {
    return this.workflowService.exportSurgeryRequestPdf(id, userId);
  }

  // ============================================================
  // DELEGAÇÃO → TEMPLATE SERVICE
  // ============================================================

  createTemplate(
    dto: { name: string; templateData: object },
    userId: string,
    ownerId: string | null,
  ) {
    return this.templateService.createTemplate(dto, userId, ownerId);
  }

  getTemplates(userId: string, ownerId: string | null) {
    return this.templateService.getTemplates(userId, ownerId);
  }

  getTemplate(id: string, userId: string, ownerId: string | null) {
    return this.templateService.getTemplate(id, userId, ownerId);
  }

  deleteTemplate(id: string, userId: string, ownerId: string | null) {
    return this.templateService.deleteTemplate(id, userId, ownerId);
  }

  bulkDeleteTemplates(ids: string[], userId: string, ownerId: string | null) {
    return this.templateService.bulkDeleteTemplates(ids, userId, ownerId);
  }

  updateTemplate(
    id: string,
    dto: { name?: string; templateData?: object },
    userId: string,
    ownerId: string | null,
  ) {
    return this.templateService.updateTemplate(id, dto, userId, ownerId);
  }

  incrementTemplateUsage(id: string, userId: string, ownerId: string | null) {
    return this.templateService.incrementUsage(id, userId, ownerId);
  }

  // ── Helpers privados ────────────────────────────────────────────────────────

  async getCcRecipients(id: string, userId: string) {
    const where = await this.buildAccessWhere({ id }, userId);
    const request = await this.surgeryRequestRepository.findOneSimple(where);
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);

    const recipients: Array<{ id: string; name: string; email: string }> = [];

    const doctor = await this.userRepository.findOne({ id: request.doctorId });
    if (doctor?.email) {
      recipients.push({
        id: doctor.id,
        name: doctor.name,
        email: doctor.email,
      });
    }

    const accesses =
      await this.userDoctorAccessRepository.findActiveByDoctorUserId(
        request.doctorId,
      );
    for (const access of accesses) {
      const u =
        access.user ??
        (await this.userRepository.findOne({ id: access.userId }));
      if (u?.email && !recipients.some((r) => r.id === u.id)) {
        recipients.push({ id: u.id, name: u.name, email: u.email });
      }
    }

    return recipients;
  }

  private buildAccessWhere(
    base: FindOptionsWhere<SurgeryRequest>,
    userId: string,
  ): Promise<FindOptionsWhere<SurgeryRequest>> {
    // Fail-closed: sempre escopa por ownerId (V1). Ver AccessControlService.
    return this.accessControlService.buildSurgeryAccessWhere(base, userId);
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
