import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { ReportSection } from 'src/database/entities/report-section.entity';
import {
  getPendenciesForStatus,
  PendencyConfig,
} from 'src/config/pendencies.config';
import { POST_SURGERY_REQUIRED_DOCS } from 'src/config/post-surgery-documents.config';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { SurgeryRequestTussItemRepository } from 'src/database/repositories/surgery-request-tuss-item.repository';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';

export interface ResolvedPendency extends PendencyConfig {
  resolved: boolean;
}

export interface CalculatedPendencyDto {
  key: string;
  name: string;
  description: string;
  isComplete: boolean;
  isOptional: boolean;
  isWaiting: boolean;
  responsible: 'collaborator' | 'patient' | 'doctor';
  statusContext: number;
  checkItems: Array<{ label: string; done: boolean }>;
}

export interface ValidationResultDto {
  currentStatus: number;
  statusLabel: string;
  pendencies: CalculatedPendencyDto[];
  canAdvance: boolean;
  nextStatus: number | null;
  completedCount: number;
  pendingCount: number;
  totalCount: number;
}

export interface PendencySummary {
  pending: number;
  total: number;
  canAdvance: boolean;
  items: ResolvedPendency[];
}

@Injectable()
export class PendencyValidatorService {
  private readonly logger = new Logger(PendencyValidatorService.name);

  private readonly nextStatusMap: Partial<
    Record<SurgeryRequestStatus, SurgeryRequestStatus>
  > = {
    [SurgeryRequestStatus.PENDING]: SurgeryRequestStatus.SENT,
    [SurgeryRequestStatus.SENT]: SurgeryRequestStatus.IN_ANALYSIS,
    [SurgeryRequestStatus.IN_ANALYSIS]: SurgeryRequestStatus.IN_SCHEDULING,
    [SurgeryRequestStatus.IN_SCHEDULING]: SurgeryRequestStatus.SCHEDULED,
    [SurgeryRequestStatus.SCHEDULED]: SurgeryRequestStatus.PERFORMED,
    [SurgeryRequestStatus.PERFORMED]: SurgeryRequestStatus.INVOICED,
    [SurgeryRequestStatus.INVOICED]: SurgeryRequestStatus.FINALIZED,
  };

  constructor(
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly opmeItemRepository: OpmeItemRepository,
    private readonly documentRepository: DocumentRepository,
    private readonly tussItemRepository: SurgeryRequestTussItemRepository,
    @InjectRepository(ReportSection)
    private readonly reportSectionRepository: Repository<ReportSection>,
  ) {}

  private loadRequest(id: string): Promise<SurgeryRequest | null> {
    return this.surgeryRequestRepository.findOneForPendencies(id);
  }

  private async loadRequestsBatch(
    ids: string[],
    accessibleDoctorIds: string[],
  ): Promise<SurgeryRequest[]> {
    if (ids.length === 0 || accessibleDoctorIds.length === 0) return [];

    const [base, tussItems, opmeItems, documents, reportSections] =
      await Promise.all([
        this.surgeryRequestRepository.findManyForPendencies(
          ids,
          accessibleDoctorIds,
        ),
        this.tussItemRepository.findMany({ surgeryRequestId: In(ids) }),
        this.opmeItemRepository.findMany({ surgeryRequestId: In(ids) }),
        this.documentRepository.findMany({ surgeryRequestId: In(ids) }),
        this.reportSectionRepository.find({
          where: { surgeryRequestId: In(ids) },
        }),
      ]);

    const groupBySurgeryRequestId = <
      T extends { surgeryRequestId: string | null },
    >(
      rows: T[],
    ): Map<string, T[]> => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        if (!row.surgeryRequestId) continue;
        const list = map.get(row.surgeryRequestId);
        if (list) list.push(row);
        else map.set(row.surgeryRequestId, [row]);
      }
      return map;
    };

    const tussById = groupBySurgeryRequestId(tussItems);
    const opmeById = groupBySurgeryRequestId(opmeItems);
    const documentsById = groupBySurgeryRequestId(documents);
    const reportSectionsById = groupBySurgeryRequestId(reportSections);

    return base.map((request) => ({
      ...request,
      tussItems: tussById.get(request.id) ?? [],
      opmeItems: opmeById.get(request.id) ?? [],
      documents: documentsById.get(request.id) ?? [],
      reportSections: reportSectionsById.get(request.id) ?? [],
    }));
  }

  private buildDocumentPendencies(request: SurgeryRequest): PendencyConfig[] {
    const requiredDocs = request.requiredDocuments ?? [];
    return requiredDocs.map((doc) => ({
      key: `doc_${doc.name}`,
      label: `Documento: ${doc.name}`,
      blocking: false,
      responsibleRole: 'collaborator' as const,
    }));
  }

  private isPatientDataComplete(patient?: SurgeryRequest['patient']): boolean {
    return !!(patient?.name && patient?.cpf);
  }

  private getPatientDataCheckItems(
    patient?: SurgeryRequest['patient'],
  ): Array<{ label: string; done: boolean }> {
    return [
      { label: 'Nome do paciente', done: !!patient?.name },
      { label: 'CPF', done: !!patient?.cpf },
    ];
  }

  private getCheckItems(
    request: SurgeryRequest,
    key: string,
  ): Array<{ label: string; done: boolean }> {
    const docs = request.documents ?? [];
    const procedures = request.tussItems ?? [];
    const opmeItems = request.opmeItems ?? [];

    switch (key) {
      case 'patient_data':
        return this.getPatientDataCheckItems(request.patient);

      case 'hospital_data':
        return [{ label: 'Hospital selecionado', done: !!request.hospitalId }];

      case 'tuss_procedures':
        return [
          {
            label: 'Ao menos 1 procedimento TUSS cadastrado',
            done: procedures.length > 0,
          },
        ];

      case 'opme_items':
        if (request.hasOpme === false) {
          return [
            { label: 'Sem OPME (indicado pelo colaborador)', done: true },
          ];
        }
        if (request.hasOpme === true) {
          return [
            { label: 'Uso de OPME confirmado', done: true },
            {
              label: 'Ao menos 1 item OPME cadastrado',
              done: opmeItems.length > 0,
            },
          ];
        }
        return [
          {
            label: 'Indicar se há ou não OPME nesta solicitação',
            done: false,
          },
        ];

      case 'medical_report': {
        const sections = request.reportSections ?? [];
        const doctorHasSignature =
          !!request.doctor?.doctorProfile?.signatureUrl;
        return [
          ...this.getPatientDataCheckItems(request.patient),
          {
            label: 'Ao menos 1 seção de laudo preenchida',
            done: sections.length > 0,
          },
          {
            label: 'Assinatura do médico configurada',
            done: doctorHasSignature,
          },
        ];
      }

      case 'schedule_dates':
        return [
          {
            label: 'Ao menos 1 data de preferência informada',
            done:
              Array.isArray(request.dateOptions) &&
              request.dateOptions.length > 0,
          },
        ];

      case 'confirm_receipt':
        return [
          {
            label: 'Valor recebido informado',
            done: !!request.billing?.receivedValue,
          },
          {
            label: 'Data de recebimento informada',
            done: !!request.billing?.receivedAt,
          },
        ];

      case 'post_surgery_documents': {
        const presentKeys = new Set(
          (request.documents ?? [])
            .map((d) => d.key)
            .filter((k): k is string => !!k),
        );
        return POST_SURGERY_REQUIRED_DOCS.filter((d) => d.required).map(
          (d) => ({ label: d.label, done: presentKeys.has(d.type) }),
        );
      }

      default:
        if (key.startsWith('doc_')) {
          const docName = key.slice(4);
          const hasUploaded = docs.some(
            (d) => d.name === docName || d.key === docName,
          );
          return [{ label: `Upload de "${docName}"`, done: hasUploaded }];
        }
        return [];
    }
  }

  private checkResolved(
    request: SurgeryRequest,
    pendency: PendencyConfig,
  ): boolean {
    const docs = request.documents ?? [];
    const procedures = request.tussItems ?? [];
    const opmeItems = request.opmeItems ?? [];

    switch (pendency.key) {
      case 'patient_data':
        return this.isPatientDataComplete(request.patient);

      case 'hospital_data':
        return !!request.hospitalId;

      case 'tuss_procedures':
        return procedures.length > 0;

      case 'opme_items':
        if (request.hasOpme === false) return true;
        if (request.hasOpme === true) return opmeItems.length > 0;
        return false;

      case 'medical_report': {
        const sections = request.reportSections ?? [];
        const doctorHasSignature =
          !!request.doctor?.doctorProfile?.signatureUrl;
        return (
          this.isPatientDataComplete(request.patient) &&
          sections.length > 0 &&
          doctorHasSignature
        );
      }

      case 'schedule_dates':
        return !!(
          request.dateOptions &&
          Array.isArray(request.dateOptions) &&
          request.dateOptions.length >= 1
        );

      case 'confirm_date':
        return (
          request.selectedDateIndex !== null &&
          request.selectedDateIndex !== undefined
        );

      case 'consent_term':
        return docs.some((d) => d.key === 'consent_term');

      case 'surgery_expired':
        if (!request.surgeryDate) return true;
        return new Date(request.surgeryDate) > new Date();

      case 'post_surgery_documents': {
        const present = new Set(
          (request.documents ?? [])
            .map((d) => d.key)
            .filter((k): k is string => !!k),
        );
        return POST_SURGERY_REQUIRED_DOCS.filter((d) => d.required).every((d) =>
          present.has(d.type),
        );
      }

      case 'confirm_receipt':
        return !!(
          request.billing?.receivedValue && request.billing?.receivedAt
        );

      default:
        if (pendency.key.startsWith('doc_')) {
          const docName = pendency.key.slice(4);
          return docs.some((d) => d.name === docName || d.key === docName);
        }
        return false;
    }
  }

  private evaluate(request: SurgeryRequest): {
    status: SurgeryRequestStatus;
    label: string;
    items: ResolvedPendency[];
  } {
    const config = getPendenciesForStatus(request.status);
    if (!config || config.pendencies.length === 0) {
      return { status: request.status, label: config?.label ?? '', items: [] };
    }

    const documentPendencies =
      request.status === SurgeryRequestStatus.PENDING
        ? this.buildDocumentPendencies(request)
        : [];

    const items = [...config.pendencies, ...documentPendencies].map((p) => ({
      ...p,
      resolved: this.checkResolved(request, p),
    }));
    return { status: request.status, label: config.label, items };
  }

  async validateForStatus(requestId: string): Promise<ValidationResultDto> {
    const request = await this.loadRequest(requestId);
    if (!request) {
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    }

    const { status, label, items } = this.evaluate(request);

    const pendencies: CalculatedPendencyDto[] = items.map((p) => ({
      key: p.key,
      name: p.label,
      description: '',
      isComplete: p.resolved,
      isOptional: !p.blocking,
      isWaiting: false,
      responsible: p.responsibleRole,
      statusContext: status,
      checkItems: this.getCheckItems(request, p.key),
    }));

    const completedCount = pendencies.filter((p) => p.isComplete).length;
    const pendingCount = pendencies.filter(
      (p) => !p.isComplete && !p.isOptional,
    ).length;

    return {
      currentStatus: status,
      statusLabel: label,
      pendencies,
      canAdvance: pendingCount === 0,
      nextStatus: this.nextStatusMap[status] ?? null,
      completedCount,
      pendingCount,
      totalCount: pendencies.length,
    };
  }

  async canAdvance(requestId: string): Promise<boolean> {
    const summary = await this.getSummary(requestId);
    return summary.canAdvance;
  }

  async getSummary(requestId: string): Promise<PendencySummary> {
    const request = await this.loadRequest(requestId);
    if (!request) {
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    }
    return this.computeSummary(request);
  }

  private computeSummary(request: SurgeryRequest): PendencySummary {
    const { items } = this.evaluate(request);
    const blockingPending = items.filter(
      (p) => p.blocking && !p.resolved,
    ).length;

    return {
      pending: blockingPending,
      total: items.length,
      canAdvance: blockingPending === 0,
      items,
    };
  }

  async getBatchSummary(
    rawIds: string,
    accessibleDoctorIds: string[],
  ): Promise<
    Record<string, { pending: number; total: number; canAdvance: boolean }>
  > {
    const ids = rawIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    const result: Record<
      string,
      { pending: number; total: number; canAdvance: boolean }
    > = {};
    for (const id of ids) {
      result[id] = { pending: 0, total: 0, canAdvance: false };
    }

    if (ids.length === 0) return result;

    try {
      const requests = await this.loadRequestsBatch(ids, accessibleDoctorIds);
      for (const request of requests) {
        const summary = this.computeSummary(request);
        result[request.id] = {
          pending: summary.pending,
          total: summary.total,
          canAdvance: summary.canAdvance,
        };
      }
    } catch (error) {
      this.logger.warn(
        `[BATCH_SUMMARY] Falha ao carregar lote de ${ids.length} solicitações: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return result;
  }

  async assertCanAdvance(requestId: string): Promise<void> {
    const result = await this.validateForStatus(requestId);
    if (!result.canAdvance) {
      const blocking = result.pendencies
        .filter((p) => !p.isOptional && !p.isComplete)
        .map((p) => ({ key: p.key, name: p.name }));
      this.logger.warn(
        `[TRANSITION_BLOCKED] sc=${requestId} from=${result.currentStatus} pendencies=${blocking.map((p) => p.key).join(',')}`,
      );
      throw new BadRequestException({
        message: 'Existem pendências que impedem o avanço de status.',
        pendencies: blocking,
      });
    }
  }
}
