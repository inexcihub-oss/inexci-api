import {
  isClinicalDocumentIssuerProfile,
  isPhysicianProfile,
} from 'src/database/entities/doctor-profile.entity';
import { Between, FindOptionsWhere, In } from 'typeorm';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Permission } from 'src/shared/permissions';

import { FindManySurgeryRequestDto } from './dto/find-many.dto';
import { FindManyKanbanDto, KANBAN_MAX_TAKE } from './dto/find-many-kanban.dto';
import { AGENDA_MAX_TAKE, FindAgendaDto } from './dto/find-agenda.dto';
import {
  mapDetailDoctor,
  mapReceipt,
  mapSurgeryRequestDetail,
  type SurgeryRequestDetailInput,
} from './mappers/surgery-request-detail.mapper';
import { PendencyValidatorService } from './pendencies/pendency-validator.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { CreateSurgeryRequestSimpleDto } from './dto/create-surgery-request-simple.dto';
import { UserRepository } from 'src/database/repositories/user.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { ClinicalRecordRepository } from 'src/database/repositories/clinical-record.repository';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { UpdateSurgeryRequestDto } from './dto/update-surgery-request.dto';
import { UpdateSurgeryRequestBasicDto } from './dto/update-surgery-request-basic.dto';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { withActiveSpan } from 'src/shared/observability/span.util';
import { trace } from '@opentelemetry/api';

import { CreateReportSectionDto } from './dto/create-report-section.dto';
import { UpdateReportSectionDto } from './dto/update-report-section.dto';
import { ReorderReportSectionsDto } from './dto/reorder-report-sections.dto';
import {
  transformDocumentUrls,
  transformDoctorSignatureUrl,
} from 'src/shared/transformers/signed-url.transformer';
import { UserDoctorAccessRepository } from 'src/database/repositories/user-doctor-access.repository';

import { SurgeryRequestReportService } from './services/surgery-request-report.service';
import { SurgeryRequestTemplateService } from './services/surgery-request-template.service';
import { SurgeryRequestMutationService } from './services/surgery-request-mutation.service';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';
import { CidService } from './cid/cid.service';

@Injectable()
export class SurgeryRequestsService {
  constructor(
    private readonly storageService: StorageService,
    private readonly accessControlService: AccessControlService,
    private readonly userRepository: UserRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly opmeItemRepository: OpmeItemRepository,
    private readonly userDoctorAccessRepository: UserDoctorAccessRepository,
    private readonly pendencyValidatorService: PendencyValidatorService,
    private readonly mutationService: SurgeryRequestMutationService,
    private readonly reportService: SurgeryRequestReportService,
    private readonly templateService: SurgeryRequestTemplateService,
    private readonly cidService: CidService,
    private readonly clinicalRecordRepository: ClinicalRecordRepository,
  ) {}

  createSurgeryRequest(data: CreateSurgeryRequestSimpleDto, userId: string) {
    return this.mutationService.createSurgeryRequest(data, userId);
  }

  async findAll(
    query: FindManySurgeryRequestDto,
    userId: string,
    userPermissions: Permission[],
  ) {
    if (
      !userPermissions.includes(Permission.SOLICITACOES) &&
      !query.patientId
    ) {
      throw new ForbiddenException(
        'Informe o paciente (patientId) para consultar as cirurgias dele — sem a permissão de Solicitações não é possível listar a carteira cirúrgica completa.',
      );
    }

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
        const [summaries, suppliersById, clinicsById] = await Promise.all([
          ids.length
            ? this.pendencyValidatorService.getBatchSummary(
                ids.join(','),
                doctorIds,
              )
            : Promise.resolve(
                {} as Record<
                  string,
                  { pending: number; total: number; canAdvance: boolean }
                >,
              ),
          this.loadSelectedSuppliers(ids),
          this.loadOriginClinics(ids),
        ]);

        const cards = records.map((record) => ({
          ...this.toKanbanCard(
            record,
            summaries[String(record.id)],
            suppliersById.get(String(record.id)),
          ),
          clinic: clinicsById.get(String(record.id)) ?? null,
        }));

        return { total, records: cards };
      },
    );
  }

  private async loadSelectedSuppliers(
    requestIds: string[],
  ): Promise<Map<string, Array<{ id: string; name: string }>>> {
    const byRequest = new Map<string, Array<{ id: string; name: string }>>();
    if (requestIds.length === 0) return byRequest;

    const rows =
      await this.opmeItemRepository.findSelectedSuppliersByRequestIds(
        requestIds,
      );

    for (const row of rows) {
      const list = byRequest.get(row.surgeryRequestId) ?? [];
      if (!list.some((supplier) => supplier.id === row.supplierId)) {
        list.push({ id: row.supplierId, name: row.supplierName });
      }
      byRequest.set(row.surgeryRequestId, list);
    }

    return byRequest;
  }

  private async loadOriginClinics(
    requestIds: string[],
  ): Promise<Map<string, { id: string; name: string }>> {
    const byRequest = new Map<string, { id: string; name: string }>();
    if (requestIds.length === 0) return byRequest;

    const rows =
      await this.clinicalRecordRepository.findClinicsBySurgeryRequestIds(
        requestIds,
      );
    for (const row of rows) {
      if (!byRequest.has(row.surgeryRequestId)) {
        byRequest.set(row.surgeryRequestId, {
          id: row.clinicId,
          name: row.clinicName,
        });
      }
    }
    return byRequest;
  }

  private toKanbanCard(
    record: SurgeryRequest & {
      pendenciesCount: number;
      totalPendencies: number;
      hasIncompletePayment: boolean;
    },
    summary?: { pending: number; total: number; canAdvance: boolean },
    suppliers?: Array<{ id: string; name: string }>,
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
      suppliers: suppliers ?? [],
    };
  }

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

        const suppliersById = await this.loadSelectedSuppliers(
          records.map((record) => String(record.id)),
        );

        return {
          total,
          records: records.map((record) =>
            this.toKanbanCard(
              record,
              undefined,
              suppliersById.get(String(record.id)),
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

        return mapSurgeryRequestDetail(
          surgeryRequest as SurgeryRequestDetailInput,
          mapDetailDoctor(doctor),
          mapReceipt(surgeryRequest.billing),
          resolvedCid,
        );
      },
    );
  }

  update(data: UpdateSurgeryRequestDto, userId: string) {
    return this.mutationService.update(data, userId);
  }

  updateBasic(data: UpdateSurgeryRequestBasicDto, userId: string) {
    return this.mutationService.updateBasic(data, userId);
  }

  setHasOpme(id: string, hasOpme: boolean, userId: string) {
    return this.mutationService.setHasOpme(id, hasOpme, userId);
  }

  addTussItem(
    surgeryRequestId: string,
    data: { tussCode: string; name: string; quantity: number },
    userId: string,
  ) {
    return this.mutationService.addTussItem(surgeryRequestId, data, userId);
  }

  updateTussItem(
    tussItemId: string,
    data: { tussCode?: string; name?: string; quantity?: number },
    userId: string,
  ) {
    return this.mutationService.updateTussItem(tussItemId, data, userId);
  }

  removeTussItem(tussItemId: string, userId: string) {
    return this.mutationService.removeTussItem(tussItemId, userId);
  }

  async getAvailableDoctors(userId: string) {
    const doctors =
      await this.accessControlService.getAvailableDoctorsForCreation(userId);
    return doctors.map((d) => ({
      id: d.id,
      name: d.name,
      crm: d.doctorProfile?.crm,
      crmState: d.doctorProfile?.crmState,
      specialty: d.doctorProfile?.specialty,
      council: d.doctorProfile?.council,
      isPhysician: isPhysicianProfile(d.doctorProfile),
      canIssueClinicalDocuments: isClinicalDocumentIssuerProfile(
        d.doctorProfile,
      ),
    }));
  }

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
    return this.accessControlService.buildSurgeryAccessWhere(base, userId);
  }
}
