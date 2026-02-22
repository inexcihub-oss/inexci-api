import { BadRequestException } from '@nestjs/common';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';

/**
 * SurgeryRequestStateMachine
 *
 * Classe de validação de pré-requisitos para transições de status.
 * NÃO aplica transições — apenas valida se elas são permitidas.
 * Cada endpoint de transição (Fase 4.2) chama assertCanTransition() antes de mudar o status.
 */
export class SurgeryRequestStateMachine {
  /**
   * Verifica se a transição para o targetStatus é permitida.
   */
  canTransitionTo(
    request: SurgeryRequest,
    targetStatus: SurgeryRequestStatus,
  ): boolean {
    return this.getBlockingPendencies(request, targetStatus).length === 0;
  }

  /**
   * Retorna a lista de pré-requisitos não atendidos para a transição.
   */
  getBlockingPendencies(
    request: SurgeryRequest,
    targetStatus: SurgeryRequestStatus,
  ): string[] {
    const pendencies: string[] = [];

    switch (targetStatus) {
      // ── PENDING → SENT ──────────────────────────────────────────────────
      case SurgeryRequestStatus.SENT: {
        if (request.status !== SurgeryRequestStatus.PENDING) {
          pendencies.push(
            'A solicitação precisa estar com status Pendente para ser enviada.',
          );
        }
        // Validações de dados obrigatórios
        if (!request.patient_id) pendencies.push('Paciente não informado.');
        if (!request.hospital_id) pendencies.push('Hospital não informado.');
        const procedures = request.procedures ?? [];
        if (procedures.length === 0)
          pendencies.push('Nenhum procedimento TUSS informado.');
        break;
      }

      // ── SENT → IN_ANALYSIS ──────────────────────────────────────────────
      case SurgeryRequestStatus.IN_ANALYSIS: {
        if (request.status !== SurgeryRequestStatus.SENT) {
          pendencies.push(
            'A solicitação precisa estar com status Enviada para iniciar análise.',
          );
        }
        // analysis deve ser criada pelo endpoint start-analysis com request_number + received_at
        // A validação de campos é feita no DTO do endpoint
        break;
      }

      // ── IN_ANALYSIS → IN_SCHEDULING ─────────────────────────────────────
      case SurgeryRequestStatus.IN_SCHEDULING: {
        if (request.status !== SurgeryRequestStatus.IN_ANALYSIS) {
          pendencies.push(
            'A solicitação precisa estar Em Análise para aceitar autorização.',
          );
        }
        // Nota: date_options é fornecido pelo DTO da transição (AcceptAuthorizationDto),
        // não precisa ser uma pré-condição no estado atual da solicitação.
        break;
      }

      // ── IN_SCHEDULING → SCHEDULED ───────────────────────────────────────
      case SurgeryRequestStatus.SCHEDULED: {
        if (request.status !== SurgeryRequestStatus.IN_SCHEDULING) {
          pendencies.push(
            'A solicitação precisa estar Em Agendamento para confirmar data.',
          );
        }
        // Nota: selected_date_index e surgery_date são definidos pelo endpoint confirm-date
        break;
      }

      // ── SCHEDULED → PERFORMED ────────────────────────────────────────────
      case SurgeryRequestStatus.PERFORMED: {
        if (request.status !== SurgeryRequestStatus.SCHEDULED) {
          pendencies.push(
            'A solicitação precisa estar Agendada para ser marcada como Realizada.',
          );
        }
        // Nota: surgery_performed_at é definido pelo endpoint mark-performed
        break;
      }

      // ── PERFORMED → INVOICED ─────────────────────────────────────────────
      case SurgeryRequestStatus.INVOICED: {
        if (request.status !== SurgeryRequestStatus.PERFORMED) {
          pendencies.push(
            'A solicitação precisa estar Realizada para ser faturada.',
          );
        }
        if (!request.billing?.invoice_value) {
          pendencies.push('Valor da fatura não informado.');
        }
        if (!request.billing?.invoice_sent_at) {
          pendencies.push('Data de envio da fatura não informada.');
        }
        break;
      }

      // ── INVOICED → FINALIZED ──────────────────────────────────────────────
      case SurgeryRequestStatus.FINALIZED: {
        if (request.status !== SurgeryRequestStatus.INVOICED) {
          pendencies.push(
            'A solicitação precisa estar Faturada para ser finalizada.',
          );
        }
        if (!request.billing?.received_value) {
          pendencies.push('Valor recebido não informado.');
        }
        if (!request.billing?.received_at) {
          pendencies.push('Data de recebimento não informada.');
        }
        break;
      }

      // ── QUALQUER → CLOSED ─────────────────────────────────────────────────
      case SurgeryRequestStatus.CLOSED: {
        if (
          request.status === SurgeryRequestStatus.FINALIZED ||
          request.status === SurgeryRequestStatus.CLOSED
        ) {
          pendencies.push(
            `Não é possível encerrar uma solicitação com status ${
              request.status === SurgeryRequestStatus.FINALIZED
                ? 'Finalizada'
                : 'Encerrada'
            }.`,
          );
        }
        break;
      }

      default:
        pendencies.push(
          `Transição para status ${targetStatus} não reconhecida.`,
        );
    }

    return pendencies;
  }

  /**
   * Valida a transição e lança BadRequestException com lista de pendências se não puder avançar.
   */
  assertCanTransition(
    request: SurgeryRequest,
    targetStatus: SurgeryRequestStatus,
  ): void {
    const blocking = this.getBlockingPendencies(request, targetStatus);
    if (blocking.length > 0) {
      throw new BadRequestException({
        message: 'Não é possível realizar esta transição.',
        pendencies: blocking,
      });
    }
  }
}
