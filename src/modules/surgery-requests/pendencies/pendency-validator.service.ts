import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
    @InjectRepository(SurgeryRequest)
    private readonly surgeryRequestRepository: Repository<SurgeryRequest>,
    private readonly opmeItemRepository: OpmeItemRepository,
    private readonly documentRepository: DocumentRepository,
    private readonly tussItemRepository: SurgeryRequestTussItemRepository,
    @InjectRepository(ReportSection)
    private readonly reportSectionRepository: Repository<ReportSection>,
  ) {}

  /**
   * Relações realmente consultadas por `checkResolved`/`getCheckItems`.
   * hospital/healthPlan/procedure/analysis/contestations foram removidas porque
   * os checks só leem colunas escalares (ex.: `hospitalId`), não os objetos das
   * relações. `relationLoadStrategy: 'query'` evita o produto cartesiano entre as
   * coleções to-many (tussItems, opmeItems, documents, reportSections).
   */
  private static readonly PENDENCY_RELATIONS = {
    patient: true,
    doctor: { doctorProfile: true },
    tussItems: true,
    opmeItems: true,
    documents: true,
    billing: true,
    reportSections: true,
  } as const;

  /**
   * Carrega a solicitação com as relações necessárias para avaliação.
   */
  private loadRequest(id: string): Promise<SurgeryRequest | null> {
    return this.surgeryRequestRepository.findOne({
      where: { id },
      relationLoadStrategy: 'query',
      relations: PendencyValidatorService.PENDENCY_RELATIONS,
    });
  }

  /**
   * Carrega várias solicitações de uma vez (WHERE id IN) para o resumo em lote do
   * kanban. Antes eram 7-8 round-trips SEQUENCIAIS (`relationLoadStrategy: 'query'`
   * com todas as relações numa única chamada `find`); agora são 2 round-trips de
   * wall-time: (a) 1 query com `join` para as relações *ToOne (não multiplicam
   * linhas: `patient`, `billing`, `doctor.doctorProfile`) e (b) as 4 coleções
   * *ToMany reais em paralelo via `Promise.all` (WHERE IN), evitando o produto
   * cartesiano que um join direto causaria.
   */
  private async loadRequestsBatch(
    ids: string[],
    ownerId: string | null,
  ): Promise<SurgeryRequest[]> {
    if (ids.length === 0) return [];

    const [base, tussItems, opmeItems, documents, reportSections] =
      await Promise.all([
        this.surgeryRequestRepository.find({
          // Fail-closed: só SCs do tenant do usuário (V1). Ids de outra clínica
          // não carregam e permanecem nos defaults seguros. ownerId null →
          // In([]) não casa nada.
          where: { id: In(ids), ownerId: In(ownerId ? [ownerId] : []) },
          relationLoadStrategy: 'join',
          relations: {
            patient: true,
            billing: true,
            doctor: { doctorProfile: true },
          },
        }),
        this.tussItemRepository.findMany({ surgeryRequestId: In(ids) }),
        this.opmeItemRepository.findMany({ surgeryRequestId: In(ids) }),
        this.documentRepository.findMany({ surgeryRequestId: In(ids) }),
        this.reportSectionRepository.find({
          where: { surgeryRequestId: In(ids) },
        }),
      ]);

    const groupBySurgeryRequestId = <T extends { surgeryRequestId: string }>(
      rows: T[],
    ): Map<string, T[]> => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
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

  /**
   * Gera pendências dinâmicas a partir dos documentos obrigatórios definidos no template.
   */
  private buildDocumentPendencies(request: SurgeryRequest): PendencyConfig[] {
    const requiredDocs: Array<{ type: string; name: string }> =
      (request as any).requiredDocuments ?? [];
    return requiredDocs.map((doc) => ({
      key: `doc_${doc.name}`,
      label: `Documento: ${doc.name}`,
      blocking: false, // documentos são avisos, não bloqueantes
      responsibleRole: 'collaborator' as const,
    }));
  }

  /** Nome e CPF são os únicos campos obrigatórios do paciente. */
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

  /**
   * Retorna os sub-itens de checklist para cada tipo de pendência.
   */
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
        // Pendências dinâmicas de documentos (prefixo 'doc_')
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

  /**
   * Verifica se uma pendência individual está resolvida.
   */
  private checkResolved(
    request: SurgeryRequest,
    pendency: PendencyConfig,
  ): boolean {
    const docs = request.documents ?? [];
    const procedures = request.tussItems ?? [];
    const opmeItems = request.opmeItems ?? [];

    switch (pendency.key) {
      // ── PENDING ──────────────────────────────────────────────────────────
      case 'patient_data':
        return this.isPatientDataComplete(request.patient);

      case 'hospital_data':
        return !!request.hospitalId;

      case 'tuss_procedures':
        return procedures.length > 0;

      case 'opme_items':
        // hasOpme === false → usuário indicou que não há OPME (pendência dispensada)
        if (request.hasOpme === false) return true;
        // hasOpme === true → precisa ter ao menos 1 item cadastrado
        if (request.hasOpme === true) return opmeItems.length > 0;
        // hasOpme === null/undefined → usuário ainda não indicou (pendência aberta)
        return false;

      case 'medical_report': {
        // Campos obrigatórios: nome + CPF do paciente + ao menos 1 seção de laudo
        // preenchida + assinatura do médico configurada.
        const sections = request.reportSections ?? [];
        const doctorHasSignature =
          !!request.doctor?.doctorProfile?.signatureUrl;
        return (
          this.isPatientDataComplete(request.patient) &&
          sections.length > 0 &&
          doctorHasSignature
        );
      }

      // ── IN_SCHEDULING ─────────────────────────────────────────────────────
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
        // Resolvida se o termo já foi anexado em qualquer fase (início ou agendamento).
        return docs.some((d) => d.key === 'consent_term');

      // ── SCHEDULED ────────────────────────────────────────────────────────
      case 'surgery_expired':
        // Aviso: data da cirurgia está no passado
        if (!request.surgeryDate) return true; // sem data = sem aviso
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

      // ── INVOICED ─────────────────────────────────────────────────────────
      case 'confirm_receipt':
        return !!(
          request.billing?.receivedValue && request.billing?.receivedAt
        );

      default:
        // Pendências dinâmicas de documentos (prefixo 'doc_')
        if (pendency.key.startsWith('doc_')) {
          const docName = pendency.key.slice(4);
          return docs.some((d) => d.name === docName || d.key === docName);
        }
        return false;
    }
  }

  /**
   * Retorna o resultado completo de validação no formato esperado pelo frontend.
   */
  async validateForStatus(
    requestId: string,
    targetStatus?: SurgeryRequestStatus,
  ): Promise<ValidationResultDto> {
    const request = await this.loadRequest(requestId);
    if (!request) {
      return {
        currentStatus: 0,
        statusLabel: '',
        pendencies: [],
        canAdvance: true,
        nextStatus: null,
        completedCount: 0,
        pendingCount: 0,
        totalCount: 0,
      };
    }

    const status = targetStatus ?? request.status;
    const config = getPendenciesForStatus(status);

    if (!config || config.pendencies.length === 0) {
      return {
        currentStatus: status,
        statusLabel: config?.label ?? '',
        pendencies: [],
        canAdvance: true,
        nextStatus: this.nextStatusMap[status] ?? null,
        completedCount: 0,
        pendingCount: 0,
        totalCount: 0,
      };
    }

    // Combina pendências fixas + pendências dinâmicas de documentos obrigatórios.
    // Documentos do template só fazem sentido no status PENDING (antes do envio).
    const documentPendencies =
      status === SurgeryRequestStatus.PENDING
        ? this.buildDocumentPendencies(request)
        : [];
    const allPendencies: PendencyConfig[] = [
      ...config.pendencies,
      ...documentPendencies,
    ];

    const pendencies: CalculatedPendencyDto[] = allPendencies.map((p) => ({
      key: p.key,
      name: p.label,
      description: '',
      isComplete: this.checkResolved(request, p),
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
    const canAdvance = pendingCount === 0;

    return {
      currentStatus: status,
      statusLabel: config.label,
      pendencies,
      canAdvance,
      nextStatus: this.nextStatusMap[status] ?? null,
      completedCount,
      pendingCount,
      totalCount: pendencies.length,
    };
  }

  /**
   * Verifica se a solicitação pode avançar de status (sem pendências bloqueantes).
   */
  async canAdvance(requestId: string): Promise<boolean> {
    const summary = await this.getSummary(requestId);
    return summary.canAdvance;
  }

  /**
   * Retorna um resumo de pendências: pending, total, canAdvance, items.
   */
  async getSummary(requestId: string): Promise<PendencySummary> {
    const request = await this.loadRequest(requestId);
    if (!request) {
      return { pending: 0, total: 0, canAdvance: true, items: [] };
    }
    return this.computeSummary(request);
  }

  /**
   * Computa o resumo de pendências de uma solicitação já carregada (sem I/O).
   * Compartilhado por `getSummary` (1 request) e `getBatchSummary` (lote).
   */
  private computeSummary(request: SurgeryRequest): PendencySummary {
    const config = getPendenciesForStatus(request.status);
    if (!config || config.pendencies.length === 0) {
      return { pending: 0, total: 0, canAdvance: true, items: [] };
    }

    // Documentos do template só fazem sentido no status PENDING (antes do envio).
    const documentPendencies =
      request.status === SurgeryRequestStatus.PENDING
        ? this.buildDocumentPendencies(request)
        : [];
    const allPendencies: PendencyConfig[] = [
      ...config.pendencies,
      ...documentPendencies,
    ];

    const items: ResolvedPendency[] = allPendencies.map((p) => ({
      ...p,
      resolved: this.checkResolved(request, p),
    }));

    const blockingPending = items.filter(
      (p) => p.blocking && !p.resolved,
    ).length;

    return {
      pending: blockingPending,
      total: allPendencies.length,
      canAdvance: blockingPending === 0,
      items,
    };
  }

  async getBatchSummary(
    rawIds: string,
    ownerId: string | null,
  ): Promise<
    Record<string, { pending: number; total: number; canAdvance: boolean }>
  > {
    const ids = rawIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    // Default seguro para todo id solicitado (inclusive os não encontrados).
    const result: Record<
      string,
      { pending: number; total: number; canAdvance: boolean }
    > = {};
    for (const id of ids) {
      result[id] = { pending: 0, total: 0, canAdvance: true };
    }

    if (ids.length === 0) return result;

    try {
      // Uma única carga em lote em vez de N cargas pesadas em paralelo (N+1).
      const requests = await this.loadRequestsBatch(ids, ownerId);
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
      // Mantém os defaults já preenchidos.
    }

    return result;
  }

  /**
   * Lança BadRequestException quando há pendências bloqueantes não resolvidas.
   * Deve ser chamado nos handlers de transição antes de executeInTransaction.
   */
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

  /**
   * Versão síncrona para cálculos rápidos no kanban (sem I/O).
   */
  calculatePendenciesSync(request: SurgeryRequest): {
    pendingCount: number;
    completedCount: number;
    totalCount: number;
  } {
    const config = getPendenciesForStatus(request.status);
    if (!config || config.pendencies.length === 0) {
      return { pendingCount: 0, completedCount: 0, totalCount: 0 };
    }

    const allPendencies: PendencyConfig[] = [
      ...config.pendencies,
      ...this.buildDocumentPendencies(request),
    ];

    let pendingCount = 0;
    let completedCount = 0;

    for (const p of allPendencies) {
      const resolved = this.checkResolved(request, p);
      if (resolved) {
        completedCount++;
      } else if (p.blocking) {
        pendingCount++;
      }
    }

    return {
      pendingCount,
      completedCount,
      totalCount: allPendencies.length,
    };
  }
}
