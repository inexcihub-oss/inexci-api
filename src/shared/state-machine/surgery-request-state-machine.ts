import { BadRequestException } from '@nestjs/common';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';

/**
 * SurgeryRequestStateMachine
 *
 * Valida APENAS a parte estrutural da transição: se o status atual é o
 * esperado para a transição alvo. Toda validação de completude de dados
 * é responsabilidade do PendencyValidatorService (assertCanAdvance).
 */
export class SurgeryRequestStateMachine {
  canTransitionTo(
    request: SurgeryRequest,
    targetStatus: SurgeryRequestStatus,
  ): boolean {
    return this.getBlockingPendencies(request, targetStatus).length === 0;
  }

  getBlockingPendencies(
    request: SurgeryRequest,
    targetStatus: SurgeryRequestStatus,
  ): string[] {
    const pendencies: string[] = [];

    switch (targetStatus) {
      case SurgeryRequestStatus.SENT:
        if (request.status !== SurgeryRequestStatus.PENDING) {
          pendencies.push(
            'A solicitação precisa estar com status Pendente para ser enviada.',
          );
        }
        break;

      case SurgeryRequestStatus.IN_ANALYSIS:
        if (request.status !== SurgeryRequestStatus.SENT) {
          pendencies.push(
            'A solicitação precisa estar com status Enviada para iniciar análise.',
          );
        }
        break;

      case SurgeryRequestStatus.IN_SCHEDULING:
        if (request.status !== SurgeryRequestStatus.IN_ANALYSIS) {
          pendencies.push(
            'A solicitação precisa estar Em Análise para aceitar autorização.',
          );
        }
        break;

      case SurgeryRequestStatus.SCHEDULED:
        if (request.status !== SurgeryRequestStatus.IN_SCHEDULING) {
          pendencies.push(
            'A solicitação precisa estar Em Agendamento para confirmar data.',
          );
        }
        break;

      case SurgeryRequestStatus.PERFORMED:
        if (request.status !== SurgeryRequestStatus.SCHEDULED) {
          pendencies.push(
            'A solicitação precisa estar Agendada para ser marcada como Realizada.',
          );
        }
        break;

      case SurgeryRequestStatus.INVOICED:
        if (request.status !== SurgeryRequestStatus.PERFORMED) {
          pendencies.push(
            'A solicitação precisa estar Realizada para ser faturada.',
          );
        }
        break;

      case SurgeryRequestStatus.FINALIZED:
        if (request.status !== SurgeryRequestStatus.INVOICED) {
          pendencies.push(
            'A solicitação precisa estar Faturada para ser finalizada.',
          );
        }
        break;

      case SurgeryRequestStatus.CLOSED:
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

      default:
        pendencies.push(
          `Transição para status ${targetStatus} não reconhecida.`,
        );
    }

    return pendencies;
  }

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
