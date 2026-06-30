import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestWorkflowService } from '../../../modules/surgery-requests/services/surgery-request-workflow.service';
import { SurgeryRequestMutationService } from '../../../modules/surgery-requests/services/surgery-request-mutation.service';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { ActivityType } from '../../../database/entities/surgery-request-activity.entity';
import { resolveAuthorizedRequest as resolveAuthorizedRequestImpl } from './_helpers/resolve-surgery-request';
import { extractTransitionErrorMessage } from './flow-draft-transition/_helpers';
import { buildToolResult } from './tool-result';

const STATUS_LABELS: Record<number, string> = {
  1: 'Pendente',
  2: 'Enviada',
  3: 'Em Análise',
  4: 'Em Agendamento',
  5: 'Agendada',
  6: 'Realizada',
  7: 'Faturada',
  8: 'Finalizada',
  9: 'Encerrada',
};

const NEXT_STATUS: Record<number, number> = {
  1: 2,
  2: 3,
  3: 4,
  4: 5,
  5: 6,
  6: 7,
  7: 8,
};

/**
 * Re-exporta o helper compartilhado para manter compatibilidade com imports
 * existentes. A implementação real vive em `_helpers/resolve-surgery-request`
 * para ser reutilizada por helpers de transição que também precisam aceitar
 * tanto UUID quanto protocolo (SC-XXXX).
 */
export const resolveAuthorizedRequest = resolveAuthorizedRequestImpl;

export function buildActionTools(
  surgeryRequestRepo: SurgeryRequestRepository,
  workflowService: SurgeryRequestWorkflowService,
  mutationService: SurgeryRequestMutationService,
  pendencyValidator: PendencyValidatorService,
  activityRepo: SurgeryRequestActivityRepository,
): AiTool[] {
  /**
   * Mapa de transições que exigem fluxo guiado com draft. Quando o usuário
   * pede "avançar" via `advance_surgery_request` para um desses status, a
   * tool bloqueia e direciona para a intent correta do `plan_actions`.
   *
   * Reflete os modais do frontend: cada transição abaixo abre um modal com
   * campos obrigatórios que NÃO podem ser silenciosamente preenchidos com
   * valores vazios.
   */
  const TRANSITIONS_REQUIRING_DRAFT: Record<
    number,
    { intent: string; label: string; what: string }
  > = {
    1: {
      intent: 'send_sc',
      label: 'envio da SC para análise',
      what: 'método de envio (e-mail ou download) e, se for e-mail, destinatários + assunto',
    },
    2: {
      intent: 'start_analysis',
      label: 'início da análise',
      what: 'número da solicitação na operadora, data de recebimento e cotações opcionais',
    },
    3: {
      intent: 'accept_authorization',
      label: 'aceite da autorização',
      what: 'até 3 datas propostas para a cirurgia',
    },
    5: {
      intent: 'mark_performed',
      label: 'marcação como realizada',
      what: 'data de realização e documentos cirúrgicos obrigatórios (folha de sala, imagens, autorização)',
    },
  };

  const advanceSurgeryRequest: AiTool = {
    name: 'advance_surgery_request',
    definition: {
      type: 'function',
      function: {
        name: 'advance_surgery_request',
        description:
          'Avança uma solicitação cirúrgica para a próxima etapa do fluxo. Só funciona em transições "simples" (4→5 com data já confirmada, 6→7 com fatura informada, 7→8 com recebimento informado). Para transições "ricas" (1→2, 2→3, 3→4, 5→6) use `plan_actions` com a intent apropriada.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description:
                'Identificador da solicitação. Aceita UUID, protocolo (SC-XXXX) ou apenas o número do protocolo (XXXX).',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a transição. Se false ou omitido, apenas mostra o que seria feito.',
            },
            selectedDateIndex: {
              type: 'number',
              description:
                'Opcional no avanço 4->5. Índice da data (0, 1 ou 2).',
            },
            surgeryPerformedAt: {
              type: 'string',
              description:
                'Opcional no avanço 5->6. Data de realização em formato ISO.',
            },
            invoiceProtocol: {
              type: 'string',
              description:
                'Necessário no avanço 6->7 quando não houver protocolo definido.',
            },
            invoiceValue: {
              type: 'number',
              description:
                'Necessário no avanço 6->7 quando não houver valor da fatura definido.',
            },
            invoiceSentAt: {
              type: 'string',
              description:
                'Opcional no avanço 6->7. Data de envio da fatura em formato ISO.',
            },
            receivedValue: {
              type: 'number',
              description:
                'Opcional no avanço 7->8. Valor recebido. Se omitido, tenta usar valor da fatura.',
            },
            receivedAt: {
              type: 'string',
              description:
                'Opcional no avanço 7->8. Data do recebimento em formato ISO.',
            },
          },
          required: ['surgeryRequestId'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return 'Você precisa estar cadastrado para executar esta ação.';

      const auth = await resolveAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.request) return auth.error as string;

      const request = auth.request;
      const requestId = request.id as string;
      const detailedRequest = await surgeryRequestRepo.findOne({
        id: requestId,
      });

      const canAdvance = await pendencyValidator.canAdvance(requestId);
      const currentLabel =
        STATUS_LABELS[request.status] || String(request.status);
      const nextStatus = NEXT_STATUS[request.status];
      const nextLabel = nextStatus ? STATUS_LABELS[nextStatus] : null;

      if (!canAdvance) {
        const summary = await pendencyValidator.getSummary(requestId);
        const blockingLines = summary.items
          .filter((p) => p.blocking && !p.resolved)
          .map((p) => `• ${p.label}`)
          .join('\n');
        return `A solicitação ${request.protocol} ainda tem pendências bloqueantes e não pode avançar de *${currentLabel}*:\n${blockingLines}\n\nResolva essas pendências antes de tentar avançar.`;
      }

      if (!nextLabel) {
        return `A solicitação ${request.protocol} já está no status final: ${currentLabel}.`;
      }

      const draftTransition = TRANSITIONS_REQUIRING_DRAFT[request.status];
      if (draftTransition) {
        return `Para o ${draftTransition.label} da solicitação ${request.protocol} (${currentLabel} → ${nextLabel}), preciso coletar: ${draftTransition.what}.\n\nChame \`plan_actions\` com intent="${draftTransition.intent}" e surgeryRequestId="${request.protocol}" para iniciar o fluxo guiado. Não use \`advance_surgery_request\` para essa transição.`;
      }

      if (!args.confirm) {
        return `A solicitação *${request.protocol}* será avançada de *${currentLabel}* para *${nextLabel}*.\n\nDeseja confirmar? Responda "sim" para prosseguir.`;
      }

      try {
        switch (request.status) {
          case 4: {
            const selectedDateIndex =
              typeof args.selectedDateIndex === 'number'
                ? args.selectedDateIndex
                : detailedRequest?.selectedDateIndex;

            if (
              !Number.isInteger(selectedDateIndex) ||
              ![0, 1, 2].includes(selectedDateIndex as number)
            ) {
              return 'Para avançar de Em Agendamento para Agendada, informe `selectedDateIndex` (0, 1 ou 2) ou confirme a data antes com `confirm_date`.';
            }

            await workflowService.confirmDate(
              requestId,
              { selectedDateIndex: selectedDateIndex as number } as any,
              context.userId,
            );
            break;
          }
          case 6: {
            const invoiceProtocol =
              typeof args.invoiceProtocol === 'string' &&
              args.invoiceProtocol.trim().length
                ? args.invoiceProtocol.trim()
                : '';
            const invoiceValue =
              typeof args.invoiceValue === 'number' &&
              Number.isFinite(args.invoiceValue) &&
              args.invoiceValue >= 0
                ? args.invoiceValue
                : null;
            const invoiceSentAt =
              typeof args.invoiceSentAt === 'string' &&
              !Number.isNaN(new Date(args.invoiceSentAt).getTime())
                ? args.invoiceSentAt
                : new Date().toISOString();

            if (!invoiceProtocol || invoiceValue === null) {
              return 'Para avançar de Realizada para Faturada, informe `invoiceProtocol` e `invoiceValue`.';
            }

            await workflowService.invoiceRequest(
              requestId,
              {
                invoiceProtocol: invoiceProtocol,
                invoiceValue: invoiceValue,
                invoiceSentAt: invoiceSentAt,
              } as any,
              context.userId,
            );
            break;
          }
          case 7: {
            const billedValue =
              detailedRequest?.billing?.invoiceValue != null
                ? Number(detailedRequest.billing.invoiceValue)
                : null;
            const receivedValue =
              typeof args.receivedValue === 'number' &&
              Number.isFinite(args.receivedValue) &&
              args.receivedValue >= 0
                ? args.receivedValue
                : billedValue;
            const receivedAt =
              typeof args.receivedAt === 'string' &&
              !Number.isNaN(new Date(args.receivedAt).getTime())
                ? args.receivedAt
                : new Date().toISOString();

            if (receivedValue === null) {
              return 'Para avançar de Faturada para Finalizada, informe `receivedValue` (ou registre faturamento com valor).';
            }

            await workflowService.confirmReceipt(
              requestId,
              {
                receivedValue: receivedValue,
                receivedAt: receivedAt,
              } as any,
              context.userId,
            );
            break;
          }
          default:
            return `Avanço automático para o status ${nextLabel} não suportado via WhatsApp. Acesse a plataforma web.`;
        }
        await activityRepo.create({
          surgeryRequestId: requestId,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Solicitação avançada de "${currentLabel}" para "${nextLabel}".`,
        });
        return `Solicitação *${request.protocol}* avançada de *${currentLabel}* para *${nextLabel}* com sucesso.`;
      } catch (err: any) {
        return extractTransitionErrorMessage(err, 'Erro ao avançar a solicitação');
      }
    },
  };

  const setHasOpme: AiTool = {
    name: 'set_has_opme',
    definition: {
      type: 'function',
      function: {
        name: 'set_has_opme',
        description: 'Define se a solicitação possui OPME.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description:
                'Identificador da solicitação. Aceita UUID, protocolo (SC-XXXX) ou apenas o número do protocolo (XXXX).',
            },
            hasOpme: {
              type: 'boolean',
              description: 'True se possui OPME, false caso contrário',
            },
            confirm: {
              type: 'boolean',
              description: 'Confirmação do usuário',
            },
          },
          required: ['surgeryRequestId', 'hasOpme'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const auth = await resolveAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.request) return auth.error as string;
      const request = auth.request;
      const requestId = request.id as string;

      if (!args.confirm) {
        return `Deseja ${args.hasOpme ? 'marcar' : 'desmarcar'} a solicitação ${request.protocol} como ${args.hasOpme ? 'possuindo' : 'não possuindo'} OPME? Confirme com "sim".`;
      }

      await mutationService.setHasOpme(
        requestId,
        args.hasOpme as boolean,
        context.userId,
      );

      await activityRepo.create({
        surgeryRequestId: requestId,
        userId: context.userId,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] OPME definido como: ${args.hasOpme ? 'Sim' : 'Não'}.`,
      });

      return `Solicitação ${request.protocol} atualizada: OPME = ${args.hasOpme ? 'Sim' : 'Não'}.`;
    },
  };

  const closeSurgeryRequest: AiTool = {
    name: 'close_surgery_request',
    definition: {
      type: 'function',
      function: {
        name: 'close_surgery_request',
        description:
          'Encerra (cancela) uma solicitação cirúrgica. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description:
                'Identificador da solicitação. Aceita UUID, protocolo (SC-XXXX) ou apenas o número do protocolo (XXXX).',
            },
            reason: {
              type: 'string',
              description: 'Motivo do encerramento',
            },
            confirm: {
              type: 'boolean',
              description: 'Confirmação explícita do usuário',
            },
          },
          required: ['surgeryRequestId', 'reason'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) {
        return buildToolResult({
          status: 'blocked',
          message: 'Acesso negado.',
        });
      }

      const auth = await resolveAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.request) {
        return buildToolResult({
          status: 'blocked',
          message: auth.error as string,
        });
      }
      const request = auth.request;
      const requestId = request.id as string;

      if (!args.confirm) {
        const preview = `Atenção: você está prestes a *encerrar* a solicitação ${request.protocol}.\nMotivo: "${args.reason}"\n\nEssa ação não pode ser desfeita. Confirme com "sim".`;
        return buildToolResult({
          status: 'pending_confirmation',
          message: preview,
          pendingConfirmation: {
            tool: 'close_surgery_request',
            args: { ...args, confirm: true },
            description: 'encerrar a solicitação cirúrgica',
          },
        });
      }

      try {
        await workflowService.closeSurgeryRequest(
          requestId,
          { reason: args.reason as string } as any,
          context.userId,
        );
        await activityRepo.create({
          surgeryRequestId: requestId,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Solicitação encerrada. Motivo: "${args.reason}".`,
        });
        return buildToolResult({
          status: 'ok',
          message: `Solicitação ${request.protocol} encerrada com sucesso.`,
          affected: [{ kind: 'surgery_request', id: requestId }],
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: extractTransitionErrorMessage(err, 'Erro ao encerrar'),
        });
      }
    },
  };

  return [advanceSurgeryRequest, setHasOpme, closeSurgeryRequest];
}
