import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import {
  getPendenciesForStatus,
  PendencyConfig,
} from 'src/config/pendencies.config';
import { POST_SURGERY_REQUIRED_DOCS } from 'src/config/post-surgery-documents.config';

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
  ) {}

  /**
   * Carrega a solicitação com todas as relações necessárias para avaliação.
   */
  private loadRequest(id: string): Promise<SurgeryRequest | null> {
    return this.surgeryRequestRepository.findOne({
      where: { id },
      relations: [
        'patient',
        'hospital',
        'healthPlan',
        'procedure',
        'tussItems',
        'opmeItems',
        'documents',
        'analysis',
        'billing',
        'contestations',
        'doctor',
        'doctor.doctorProfile',
        'reportSections',
      ],
    });
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
        return [
          { label: 'Nome do paciente', done: !!request.patient?.name },
          { label: 'Data de nascimento', done: !!request.patient?.birthDate },
          { label: 'CPF', done: !!request.patient?.cpf },
          { label: 'Telefone', done: !!request.patient?.phone },
          { label: 'Endereço', done: !!request.patient?.address },
          { label: 'CEP', done: !!request.patient?.zipCode },
        ];

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
        const pt = request.patient;
        const sections = request.reportSections ?? [];
        return [
          { label: 'Nome do paciente', done: !!pt?.name },
          { label: 'Data de nascimento', done: !!pt?.birthDate },
          { label: 'CPF', done: !!pt?.cpf },
          { label: 'Telefone', done: !!pt?.phone },
          { label: 'Endereço', done: !!pt?.address },
          { label: 'CEP', done: !!pt?.zipCode },
          {
            label: 'Ao menos 1 seção de laudo preenchida',
            done: sections.length > 0,
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
        return !!(
          request.patient?.name &&
          request.patient?.birthDate &&
          request.patient?.cpf &&
          request.patient?.phone &&
          request.patient?.address &&
          request.patient?.zipCode
        );

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
        // Campos obrigatórios: dados do paciente + ao menos 1 seção de laudo preenchida.
        // A assinatura do médico é desejável para o PDF, mas não é bloqueante para o fluxo.
        const pt = request.patient;
        const patientComplete = !!(
          pt?.name &&
          pt?.birthDate &&
          pt?.cpf &&
          pt?.phone &&
          pt?.address &&
          pt?.zipCode
        );
        const sections = request.reportSections ?? [];
        return patientComplete && sections.length > 0;
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

    // Combina pendências fixas + pendências dinâmicas de documentos obrigatórios
    const allPendencies: PendencyConfig[] = [
      ...config.pendencies,
      ...this.buildDocumentPendencies(request),
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

    const config = getPendenciesForStatus(request.status);
    if (!config || config.pendencies.length === 0) {
      return { pending: 0, total: 0, canAdvance: true, items: [] };
    }

    const allPendencies: PendencyConfig[] = [
      ...config.pendencies,
      ...this.buildDocumentPendencies(request),
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
      total: config.pendencies.length,
      canAdvance: blockingPending === 0,
      items,
    };
  }

  async getBatchSummary(
    rawIds: string,
  ): Promise<
    Record<string, { pending: number; total: number; canAdvance: boolean }>
  > {
    const ids = rawIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    const summaries = await Promise.all(
      ids.map(async (id) => {
        try {
          const result = await this.getSummary(id);
          return {
            id,
            pending: result.pending,
            total: result.total,
            canAdvance: result.canAdvance,
          };
        } catch {
          return { id, pending: 0, total: 0, canAdvance: true };
        }
      }),
    );

    return summaries.reduce(
      (acc, { id, ...summary }) => {
        acc[id] = summary;
        return acc;
      },
      {} as Record<
        string,
        { pending: number; total: number; canAdvance: boolean }
      >,
    );
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
      totalCount: config.pendencies.length,
    };
  }
}
