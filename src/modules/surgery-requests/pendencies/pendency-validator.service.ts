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

export interface PendencySummary {
  pending: number;
  total: number;
  canAdvance: boolean;
  items: ResolvedPendency[];
}

@Injectable()
export class PendencyValidatorService {
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
        'procedures',
        'opme_items',
        'documents',
        'analysis',
        'billing',
        'contestations',
      ],
    });
  }

  /**
   * Verifica se uma pendência individual está resolvida.
   * BUG CORRIGIDO: usa `document.type` (não `document.document_type`).
   */
  private checkResolved(
    request: SurgeryRequest,
    pendency: PendencyConfig,
  ): boolean {
    const docs = request.documents ?? [];
    const procedures = request.procedures ?? [];
    const opmeItems = request.opme_items ?? [];

    /** Verifica se existe um documento do tipo informado */
    const hasDoc = (type: string) => docs.some((d) => d.type === type);

    switch (pendency.key) {
      // ── PENDING ──────────────────────────────────────────────────────────
      case 'patient_data':
        return !!(request.patient?.name && request.patient?.phone);

      case 'hospital_data':
        return !!request.hospital_id;

      case 'tuss_procedures':
        return procedures.length > 0;

      case 'opme_items':
        // OPME é condicional — só é pendência se houver itens cadastrados.
        return opmeItems.length > 0;

      case 'documents':
        // Documentos obrigatórios pré-cirúrgicos
        return hasDoc('personal_document') && hasDoc('doctor_request');

      case 'medical_report':
        return !!(request.medical_report || hasDoc('medical_report'));

      // ── IN_ANALYSIS ──────────────────────────────────────────────────────
      case 'contest_pending':
        // Aviso: existe contestação de autorização ativa (resolved_at = null)
        const activeContest = (request.contestations ?? []).find(
          (c) => c.type === 'authorization' && !c.resolved_at,
        );
        return !activeContest; // resolved = true quando NÃO há contestação ativa

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
   * Retorna a lista completa de pendências do status atual, com flag `resolved`.
   */
  async validateForStatus(
    requestId: string,
    targetStatus?: SurgeryRequestStatus,
  ): Promise<ResolvedPendency[]> {
    const request = await this.loadRequest(requestId);
    if (!request) return [];

    const status = targetStatus ?? request.status;
    const config = getPendenciesForStatus(status);
    if (!config) return [];

    return config.pendencies.map((p) => ({
      ...p,
      resolved: this.checkResolved(request, p),
    }));
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
