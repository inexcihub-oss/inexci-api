import { Injectable } from '@nestjs/common';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import surgeryRequestStatusesCommon from 'src/common/surgery-request-statuses.common';
import PendencyKeys from 'src/common/pendency-keys.common';

export interface CalculatedPendency {
  key: string;
  name: string;
  description: string;
  isComplete: boolean;
  isOptional: boolean;
  isWaiting: boolean;
  responsible: 'collaborator' | 'patient' | 'doctor';
  statusContext: number;
}

export interface ValidationResult {
  currentStatus: number;
  statusLabel: string;
  pendencies: CalculatedPendency[];
  canAdvance: boolean;
  nextStatus: number | null;
  completedCount: number;
  pendingCount: number;
  totalCount: number;
}

@Injectable()
export class PendencyValidatorService {
  constructor(
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
  ) {}

  /**
   * Calcula as pendências baseadas nos dados atuais da solicitação
   * Não usa tabela - tudo é calculado em tempo real
   */
  async validate(surgeryRequestId: string): Promise<ValidationResult> {
    const surgeryRequest =
      await this.surgeryRequestRepository.findOneWithRelations(
        { id: surgeryRequestId },
        [
          'patient',
          'hospital',
          'health_plan',
          'procedures',
          'opme_items',
          'documents',
          'quotations',
          'quotations.supplier',
          'cid',
        ],
      );

    if (!surgeryRequest) {
      throw new Error('Surgery request not found');
    }

    const currentStatus = surgeryRequest.status;
    const statusConfig = this.getStatusConfigByValue(currentStatus);

    if (!statusConfig) {
      return {
        currentStatus,
        statusLabel: 'Desconhecido',
        pendencies: [],
        canAdvance: false,
        nextStatus: null,
        completedCount: 0,
        pendingCount: 0,
        totalCount: 0,
      };
    }

    // Validar cada pendência do status atual
    const pendencies: CalculatedPendency[] = [];

    for (const defaultPendency of statusConfig.defaultPendencies) {
      const isComplete = this.checkPendencyComplete(
        surgeryRequest,
        defaultPendency.key,
      );

      pendencies.push({
        key: defaultPendency.key,
        name: defaultPendency.name,
        description: defaultPendency.description,
        isComplete,
        isOptional: defaultPendency.optional || false,
        isWaiting: defaultPendency.isWaiting || false,
        responsible: defaultPendency.responsible,
        statusContext: currentStatus,
      });
    }

    const completedCount = pendencies.filter((p) => p.isComplete).length;
    const pendingCount = pendencies.filter(
      (p) => !p.isComplete && !p.isOptional,
    ).length;
    const totalCount = pendencies.length;
    const canAdvance = pendingCount === 0;

    return {
      currentStatus,
      statusLabel: statusConfig.label,
      pendencies,
      canAdvance,
      nextStatus: statusConfig.nextStatus || null,
      completedCount,
      pendingCount,
      totalCount,
    };
  }

  /**
   * Verifica se uma pendência está completa baseada nos dados da solicitação
   */
  private checkPendencyComplete(
    surgeryRequest: any,
    pendencyKey: string,
  ): boolean {
    const patient = surgeryRequest.patient;
    const documents = surgeryRequest.documents || [];
    const procedures = surgeryRequest.procedures || [];
    const opmeItems = surgeryRequest.opme_items || [];
    const quotations = surgeryRequest.quotations || [];

    // Helper para verificar documentos por tipo
    const hasDocument = (type: string) =>
      documents.some((d: any) => d.document_key === type);

    // Mapeamento de validações por chave
    switch (pendencyKey) {
      // === STATUS 1: PENDENTE ===
      case PendencyKeys.patientData:
        return !!(patient?.name && patient?.email && patient?.phone);

      case PendencyKeys.hospitalData:
        return !!surgeryRequest.hospital_id;

      case PendencyKeys.healthPlanData:
        return !!(
          surgeryRequest.health_plan_id &&
          surgeryRequest.health_plan_registration
        );

      case PendencyKeys.insertTuss:
        return procedures.length > 0;

      case PendencyKeys.insertOpme:
        // Obrigatório - verifica se há pelo menos um item OPME
        return opmeItems.length > 0;

      case PendencyKeys.diagnosisData:
        return !!(surgeryRequest.cid_id && surgeryRequest.diagnosis);

      case PendencyKeys.medicalReport:
        return !!(
          surgeryRequest.medical_report || hasDocument('medical_report')
        );

      case PendencyKeys.documents.personalDocument:
        return hasDocument('personal_document');

      case PendencyKeys.documents.doctorRequest:
        return hasDocument('doctor_request');

      // === STATUS 2: ENVIADA ===
      case PendencyKeys.quotation1:
        return quotations.length >= 1;

      case PendencyKeys.quotation2:
        return quotations.length >= 2;

      case PendencyKeys.quotation3:
        return quotations.length >= 3;

      case PendencyKeys.hospitalProtocol:
        return !!surgeryRequest.hospital_protocol;

      case PendencyKeys.healthPlanProtocol:
        return !!surgeryRequest.health_plan_protocol;

      // === STATUS 3: EM ANÁLISE ===
      case PendencyKeys.waitAnalysis:
        // Pendência de espera - nunca "completa" automaticamente
        // Só é resolvida quando muda de status manualmente
        return false;

      // === STATUS 4: EM AGENDAMENTO ===
      case PendencyKeys.defineDates:
        return !!(
          surgeryRequest.date_options &&
          Array.isArray(surgeryRequest.date_options) &&
          surgeryRequest.date_options.length >= 1
        );

      case PendencyKeys.patientChooseDate:
        return surgeryRequest.selected_date_index !== null;

      // === STATUS 5: AGENDADA ===
      case PendencyKeys.documents.authorizationGuide:
        return hasDocument('authorization_guide');

      case PendencyKeys.confirmSurgery:
        // Confirmação manual - verifica se tem data de cirurgia
        return !!surgeryRequest.surgery_date;

      // === STATUS 6: REALIZADA ===
      case PendencyKeys.surgeryDescription:
        return !!surgeryRequest.surgery_description;

      case PendencyKeys.invoicedValue:
        return !!surgeryRequest.invoiced_value;

      case PendencyKeys.documents.invoiceProtocol:
        return hasDocument('invoice_protocol');

      // === STATUS 7: FATURADA ===
      case PendencyKeys.registerReceipt:
        return !!(
          surgeryRequest.received_value && surgeryRequest.received_date
        );

      default:
        // Para chaves de documentos genéricos
        if (pendencyKey.startsWith('document_')) {
          const docType = pendencyKey.replace('document_', '');
          return hasDocument(docType);
        }
        return false;
    }
  }

  /**
   * Obtém a configuração de status pelo valor numérico
   */
  private getStatusConfigByValue(value: number) {
    for (const key in surgeryRequestStatusesCommon) {
      const config = surgeryRequestStatusesCommon[key];
      if (config.value === value) {
        return config;
      }
    }
    return null;
  }

  /**
   * Retorna validação resumida para listagem (Kanban)
   */
  async getQuickSummary(surgeryRequestId: string): Promise<{
    pending: number;
    total: number;
    canAdvance: boolean;
  }> {
    const result = await this.validate(surgeryRequestId);
    return {
      pending: result.pendingCount,
      total: result.totalCount,
      canAdvance: result.canAdvance,
    };
  }
}
