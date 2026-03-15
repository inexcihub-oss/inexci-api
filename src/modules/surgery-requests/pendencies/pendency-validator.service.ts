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
  private async loadRequest(id: string): Promise<SurgeryRequest> {
    return this.surgeryRequestRepository.findOne({
      where: { id },
      relations: [
        'patient',
        'hospital',
        'health_plan',
        'procedure',
        'tuss_items',
        'opme_items',
        'documents',
        'analysis',
        'billing',
        'contestations',
        'doctor',
      ],
    });
  }

  /**
   * Retorna os sub-itens de checklist para cada tipo de pendência.
   */
  private getCheckItems(
    request: SurgeryRequest,
    key: string,
  ): Array<{ label: string; done: boolean }> {
    const docs = request.documents ?? [];
    const procedures = request.tuss_items ?? [];
    const opmeItems = request.opme_items ?? [];
    const hasDoc = (k: string) => docs.some((d) => d.key === k);
    /** Somente documentos na pasta documents/ (pré-cirúrgicos) */
    const hasPreDoc = (k: string) =>
      docs.some((d) => d.key === k && d.uri?.startsWith('documents/'));

    switch (key) {
      case 'patient_data':
        return [
          { label: 'Nome do paciente', done: !!request.patient?.name },
          { label: 'Data de nascimento', done: !!request.patient?.birth_date },
          { label: 'CPF', done: !!request.patient?.cpf },
          { label: 'Telefone', done: !!request.patient?.phone },
        ];

      case 'hospital_data':
        return [{ label: 'Hospital selecionado', done: !!request.hospital_id }];

      case 'tuss_procedures':
        return [
          {
            label: 'Ao menos 1 procedimento TUSS cadastrado',
            done: procedures.length > 0,
          },
        ];

      case 'opme_items':
        return [
          {
            label: 'Itens OPME (opcional)',
            done: true,
          },
        ];

      case 'medical_report': {
        const pt = request.patient;
        let parsed: any = {};
        try {
          parsed = JSON.parse(request.medical_report ?? '{}');
        } catch {
          parsed = {};
        }
        const hasText = (field: string) =>
          typeof parsed[field] === 'string' && parsed[field].trim().length > 0;
        return [
          { label: 'Nome do paciente', done: !!pt?.name },
          { label: 'Data de nascimento', done: !!pt?.birth_date },
          { label: 'CPF', done: !!pt?.cpf },
          { label: 'Telefone', done: !!pt?.phone },
          {
            label: 'Histórico e diagnóstico preenchido',
            done: hasText('historyAndDiagnosis'),
          },
          {
            label: 'Laudo assinado anexado',
            done: hasDoc('signed_report') || !!request.doctor?.signature_url,
          },
        ];
      }

      case 'schedule_dates':
        return [
          {
            label: 'Ao menos 1 data de preferência informada',
            done:
              Array.isArray(request.date_options) &&
              request.date_options.length > 0,
          },
        ];

      case 'confirm_receipt':
        return [
          {
            label: 'Valor recebido informado',
            done: !!request.billing?.received_value,
          },
          {
            label: 'Data de recebimento informada',
            done: !!request.billing?.received_at,
          },
        ];

      default:
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
    const procedures = request.tuss_items ?? [];
    const opmeItems = request.opme_items ?? [];

    /** Verifica se existe um documento pelo campo `key` (campo correto no backend) */
    const hasDoc = (key: string) => docs.some((d) => d.key === key);
    /** Somente documentos na pasta documents/ (pré-cirúrgicos) */
    const hasPreDoc = (k: string) =>
      docs.some((d) => d.key === k && d.uri?.startsWith('documents/'));

    switch (pendency.key) {
      // ── PENDING ──────────────────────────────────────────────────────────
      case 'patient_data':
        return !!(
          request.patient?.name &&
          request.patient?.birth_date &&
          request.patient?.cpf &&
          request.patient?.phone
        );

      case 'hospital_data':
        return !!request.hospital_id;

      case 'tuss_procedures':
        return procedures.length > 0;

      case 'opme_items':
        // OPME é opcional — não bloqueia o avanço de status.
        return true;

      case 'medical_report': {
        // Campos obrigatórios: dados do paciente + histórico + laudo assinado
        const pt = request.patient;
        const patientComplete = !!(
          pt?.name &&
          pt?.birth_date &&
          pt?.cpf &&
          pt?.phone
        );
        if (!request.medical_report) return false;
        let parsed: any = {};
        try {
          parsed = JSON.parse(request.medical_report);
        } catch {
          return false;
        }
        const hasText = (field: string) =>
          typeof parsed[field] === 'string' && parsed[field].trim().length > 0;
        return (
          patientComplete &&
          hasText('historyAndDiagnosis') &&
          (hasDoc('signed_report') || !!request.doctor?.signature_url)
        );
      }

      // ── IN_SCHEDULING ─────────────────────────────────────────────────────
      case 'schedule_dates':
        return !!(
          request.date_options &&
          Array.isArray(request.date_options) &&
          request.date_options.length >= 1
        );

      case 'confirm_date':
        return (
          request.selected_date_index !== null &&
          request.selected_date_index !== undefined
        );

      // ── SCHEDULED ────────────────────────────────────────────────────────
      case 'surgery_expired':
        // Aviso: data da cirurgia está no passado
        if (!request.surgery_date) return true; // sem data = sem aviso
        return new Date(request.surgery_date) > new Date();

      // ── INVOICED ─────────────────────────────────────────────────────────
      case 'confirm_receipt':
        return !!(
          request.billing?.received_value && request.billing?.received_at
        );

      default:
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

    const pendencies: CalculatedPendencyDto[] = config.pendencies.map((p) => ({
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

    const items: ResolvedPendency[] = config.pendencies.map((p) => ({
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

    let pendingCount = 0;
    let completedCount = 0;

    for (const p of config.pendencies) {
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
