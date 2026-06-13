import { Injectable, Logger } from '@nestjs/common';
import { SurgeryRequestWorkflowService } from '../../../modules/surgery-requests/services/surgery-request-workflow.service';
import {
  WorkflowAction,
  WorkflowResult,
  WorkflowActionType,
  DomainEvent,
} from './workflow-engine.types';

/**
 * Fachada `WorkflowEngine` (Fase 7 do Blueprint v3, §10).
 *
 * Substitui chamadas diretas das tools de IA aos múltiplos services
 * (`SurgeryRequestBillingService`, `AuthorizationHandler`, etc.) por
 * uma única superfície:
 *
 * ```ts
 * await workflowEngine.execute({
 *   type: 'send_sc',
 *   surgeryRequestId: 'uuid',
 *   payload: { sentAt: '2026-05-14' },
 *   actor: { userId, origin: 'whatsapp' },
 * });
 * ```
 *
 * Delega ao `SurgeryRequestWorkflowService` existente (não duplica lógica
 * — apenas centraliza o roteamento, normaliza erros e emite eventos
 * canônicos para telemetria/observabilidade).
 *
 * Benefícios:
 *   - Tools só dependem de UMA classe.
 *   - Auditoria uniforme (`actor.origin` registrado por evento).
 *   - Adição de novos canais (REST, cron) sem repetir o switch.
 */
@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    private readonly workflowService: SurgeryRequestWorkflowService,
  ) {}

  async execute(action: WorkflowAction): Promise<WorkflowResult> {
    const startedAt = Date.now();
    try {
      const result = await this.dispatch(action);
      const durationMs = Date.now() - startedAt;
      this.logger.debug(
        `[WORKFLOW_ENGINE] ${action.type} sc=${action.surgeryRequestId} status=${result.status} dur=${durationMs}ms origin=${action.actor.origin}`,
      );
      return result;
    } catch (err: any) {
      const durationMs = Date.now() - startedAt;
      this.logger.warn(
        `[WORKFLOW_ENGINE] ${action.type} sc=${action.surgeryRequestId} ERROR dur=${durationMs}ms msg=${err?.message}`,
      );
      return {
        status: 'error',
        events: [],
        summary:
          err?.message ?? 'Falha desconhecida ao executar ação de workflow.',
      };
    }
  }

  private async dispatch(action: WorkflowAction): Promise<WorkflowResult> {
    const { type, surgeryRequestId: id, payload, actor } = action;
    const ts = new Date().toISOString();

    // Aceita qualquer retorno do service legado (alguns handlers
    // retornam `void`, outros `SurgeryRequest`, outros DTOs específicos).
    // O `newStatus` só é populado quando vier no objeto.
    const okResult = (
      sc: unknown,
      eventName: DomainEvent['name'],
      summary: string,
    ): WorkflowResult => ({
      status: 'ok',
      newStatus:
        sc && typeof sc === 'object' && 'status' in sc
          ? ((sc as { status?: number }).status as any)
          : undefined,
      events: [
        {
          name: eventName,
          surgeryRequestId: id,
          occurredAt: ts,
          payload: { actor },
        },
      ],
      summary,
    });

    switch (type) {
      case 'send_sc': {
        const sc = await this.workflowService.sendRequest(
          id,
          payload as any,
          actor.userId,
        );
        return okResult(sc, 'sc.sent', 'SC enviada para análise.');
      }
      case 'start_analysis': {
        const sc = await this.workflowService.startAnalysis(
          id,
          payload as any,
          actor.userId,
        );
        return okResult(sc, 'sc.analysis_started', 'Análise iniciada.');
      }
      case 'accept_authorization': {
        const sc = await this.workflowService.acceptAuthorization(
          id,
          payload as any,
          actor.userId,
        );
        return okResult(sc, 'sc.authorized', 'Autorização registrada.');
      }
      case 'contest_authorization': {
        const sc = await this.workflowService.contestAuthorization(
          id,
          payload as any,
          actor.userId,
        );
        return okResult(sc, 'sc.contested', 'Contestação registrada.');
      }
      case 'confirm_date': {
        const sc = await this.workflowService.confirmDate(
          id,
          payload as any,
          actor.userId,
        );
        return okResult(sc, 'sc.scheduled', 'Data confirmada.');
      }
      case 'update_date_options': {
        const sc = await this.workflowService.updateDateOptions(
          id,
          payload as any,
          actor.userId,
        );
        return okResult(sc, 'sc.scheduled', 'Opções de data atualizadas.');
      }
      case 'reschedule': {
        const sc = await this.workflowService.reschedule(
          id,
          payload as any,
          actor.userId,
        );
        return okResult(sc, 'sc.rescheduled', 'Cirurgia reagendada.');
      }
      case 'mark_performed': {
        const sc = await this.workflowService.markPerformed(
          id,
          payload as any,
          actor.userId,
        );
        return okResult(sc, 'sc.performed', 'Cirurgia marcada como realizada.');
      }
      case 'invoice_request': {
        const sc = await this.workflowService.invoiceRequest(
          id,
          payload as any,
          actor.userId,
        );
        return okResult(sc, 'sc.invoiced', 'Faturamento registrado.');
      }
      case 'confirm_receipt': {
        const sc = await this.workflowService.confirmReceipt(
          id,
          payload as any,
          actor.userId,
        );
        return okResult(sc, 'sc.payment_received', 'Recebimento confirmado.');
      }
      case 'contest_payment': {
        const sc = await this.workflowService.contestPayment(
          id,
          payload as any,
          actor.userId,
        );
        return okResult(sc, 'sc.payment_contested', 'Contestação de pagamento registrada.');
      }
      case 'update_receipt': {
        const sc = await this.workflowService.updateReceipt(
          id,
          payload as any,
          actor.userId,
        );
        return okResult(sc, 'sc.payment_received', 'Recebimento atualizado.');
      }
      case 'close_surgery_request': {
        const sc = await this.workflowService.closeSurgeryRequest(
          id,
          payload as any,
          actor.userId,
        );
        return okResult(sc, 'sc.closed', 'SC encerrada.');
      }
      default: {
        const exhaustive: never = type;
        return {
          status: 'error',
          events: [],
          summary: `Ação desconhecida: ${exhaustive as WorkflowActionType}`,
        };
      }
    }
  }
}
