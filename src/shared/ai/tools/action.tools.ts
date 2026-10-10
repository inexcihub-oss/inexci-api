import { AiTool, ToolContext } from './tool.interface';
import { Permission } from 'src/shared/permissions';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestWorkflowService } from '../../../modules/surgery-requests/services/surgery-request-workflow.service';
import { SurgeryRequestMutationService } from '../../../modules/surgery-requests/services/surgery-request-mutation.service';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { SurgeryRequestStatus } from '../../../database/entities/surgery-request.entity';
import { ConfirmDateDto } from '../../../modules/surgery-requests/dto/confirm-date.dto';
import { getStatusLabel } from '../../utils/status';
import {
  recordAiActivity,
  resolveAuthorizedRequest,
} from './helpers/surgery-request-access';
import { extractTransitionErrorMessage } from './flow-draft-transition/_helpers';
import { buildToolResult } from './tool-result';
import { argToString } from './helpers/arg-parsers';

const NEXT_STATUS: Partial<Record<SurgeryRequestStatus, SurgeryRequestStatus>> =
  {
    [SurgeryRequestStatus.PENDING]: SurgeryRequestStatus.SENT,
    [SurgeryRequestStatus.SENT]: SurgeryRequestStatus.IN_ANALYSIS,
    [SurgeryRequestStatus.IN_ANALYSIS]: SurgeryRequestStatus.IN_SCHEDULING,
    [SurgeryRequestStatus.IN_SCHEDULING]: SurgeryRequestStatus.SCHEDULED,
    [SurgeryRequestStatus.SCHEDULED]: SurgeryRequestStatus.PERFORMED,
    [SurgeryRequestStatus.PERFORMED]: SurgeryRequestStatus.INVOICED,
    [SurgeryRequestStatus.INVOICED]: SurgeryRequestStatus.FINALIZED,
  };

const TRANSITIONS_WITH_DEDICATED_FLOW: Partial<
  Record<SurgeryRequestStatus, { label: string; what: string; how: string }>
> = {
  [SurgeryRequestStatus.PENDING]: {
    label: 'envio da SC para análise',
    what: 'método de envio (e-mail ou download) e, se for e-mail, destinatários + assunto',
    how: 'Chame `plan_actions` com intent="send_sc"',
  },
  [SurgeryRequestStatus.SENT]: {
    label: 'início da análise',
    what: 'número da solicitação na operadora, data de recebimento e cotações opcionais',
    how: 'Chame `plan_actions` com intent="start_analysis"',
  },
  [SurgeryRequestStatus.IN_ANALYSIS]: {
    label: 'aceite da autorização',
    what: 'até 3 datas propostas para a cirurgia',
    how: 'Chame `plan_actions` com intent="accept_authorization"',
  },
  [SurgeryRequestStatus.SCHEDULED]: {
    label: 'marcação como realizada',
    what: 'data de realização e documentos cirúrgicos obrigatórios (folha de sala, imagens, autorização)',
    how: 'Chame `plan_actions` com intent="mark_performed"',
  },
  [SurgeryRequestStatus.PERFORMED]: {
    label: 'registro do faturamento',
    what: 'protocolo da fatura, valor e data de envio',
    how: 'Chame `plan_actions` com intent="invoice"',
  },
  [SurgeryRequestStatus.INVOICED]: {
    label: 'confirmação do recebimento',
    what: 'valor recebido e data do recebimento',
    how: 'Use a tool `confirm_receipt`',
  },
};

export interface ActionToolDeps {
  surgeryRequestRepo: SurgeryRequestRepository;
  workflowService: SurgeryRequestWorkflowService;
  mutationService: SurgeryRequestMutationService;
  pendencyValidator: PendencyValidatorService;
  activityRepo: SurgeryRequestActivityRepository;
}

export function buildActionTools({
  surgeryRequestRepo,
  workflowService,
  mutationService,
  pendencyValidator,
  activityRepo,
}: ActionToolDeps): AiTool[] {
  const advanceSurgeryRequest: AiTool = {
    name: 'advance_surgery_request',
    requiredPermission: Permission.SOLICITACOES,
    mutates: true,
    definition: {
      type: 'function',
      function: {
        name: 'advance_surgery_request',
        description:
          'Avança uma solicitação cirúrgica para a próxima etapa do fluxo. Só executa a transição Em Agendamento → Agendada (4→5) com a data já escolhida. Para as demais transições devolve o caminho dedicado: 1→2, 2→3, 3→4, 5→6 e 6→7 via `plan_actions` com a intent apropriada; 7→8 via `confirm_receipt`.',
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
          },
          required: ['surgeryRequestId'],
        },
      },
    },
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) {
        return buildToolResult({
          status: 'blocked',
          message: 'Você precisa estar cadastrado para executar esta ação.',
        });
      }

      const auth = await resolveAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.request) {
        return buildToolResult({ status: 'blocked', message: auth.error });
      }

      const request = auth.request;
      const requestId = request.id;

      const canAdvance = await pendencyValidator.canAdvance(requestId);
      const currentLabel = getStatusLabel(request.status);
      const nextStatus = NEXT_STATUS[request.status];
      const nextLabel = nextStatus ? getStatusLabel(nextStatus) : null;

      if (!canAdvance) {
        const summary = await pendencyValidator.getSummary(requestId);
        const blockingLines = summary.items
          .filter((p) => p.blocking && !p.resolved)
          .map((p) => `• ${p.label}`)
          .join('\n');
        return buildToolResult({
          status: 'blocked',
          message: `A solicitação ${request.protocol} ainda tem pendências bloqueantes e não pode avançar de *${currentLabel}*:\n${blockingLines}\n\nResolva essas pendências antes de tentar avançar.`,
        });
      }

      if (!nextLabel) {
        return buildToolResult({
          status: 'blocked',
          message: `A solicitação ${request.protocol} já está no status final: ${currentLabel}.`,
        });
      }

      const dedicated = TRANSITIONS_WITH_DEDICATED_FLOW[request.status];
      if (dedicated) {
        return buildToolResult({
          status: 'blocked',
          message: `Para o ${dedicated.label} da solicitação ${request.protocol} (${currentLabel} → ${nextLabel}), preciso coletar: ${dedicated.what}.\n\n${dedicated.how} com surgeryRequestId="${request.protocol}" para seguir o fluxo guiado. Não use \`advance_surgery_request\` para essa transição.`,
        });
      }

      if (request.status !== SurgeryRequestStatus.IN_SCHEDULING) {
        return buildToolResult({
          status: 'blocked',
          message: `Avanço automático para o status ${nextLabel} não suportado via WhatsApp. Acesse a plataforma web.`,
        });
      }

      const detailedRequest = await surgeryRequestRepo.findOne({
        id: requestId,
      });
      const selectedDateIndex =
        typeof args.selectedDateIndex === 'number'
          ? args.selectedDateIndex
          : detailedRequest?.selectedDateIndex;

      if (
        !Number.isInteger(selectedDateIndex) ||
        ![0, 1, 2].includes(selectedDateIndex as number)
      ) {
        return buildToolResult({
          status: 'needs_input',
          message:
            'Para avançar de Em Agendamento para Agendada, informe `selectedDateIndex` (0, 1 ou 2) ou confirme a data antes com `plan_actions(intent="scheduling")` + `draft_update(scheduling, confirmedDateIndex, …)`.',
          nextRequiredFields: ['selectedDateIndex'],
        });
      }

      if (!args.confirm) {
        return buildToolResult({
          status: 'pending_confirmation',
          message: `A solicitação *${request.protocol}* será avançada de *${currentLabel}* para *${nextLabel}*.\n\nDeseja confirmar? Responda "sim" para prosseguir.`,
          pendingConfirmation: {
            tool: 'advance_surgery_request',
            args: { ...args, confirm: true },
            description: `avançar a solicitação para ${nextLabel}`,
          },
        });
      }

      try {
        const dto: ConfirmDateDto = {
          selectedDateIndex:
            selectedDateIndex as ConfirmDateDto['selectedDateIndex'],
        };
        await workflowService.confirmDate(requestId, dto, context.userId);
        await recordAiActivity(
          activityRepo,
          context,
          requestId,
          `Solicitação avançada de "${currentLabel}" para "${nextLabel}".`,
        );
        return buildToolResult({
          status: 'ok',
          message: `Solicitação *${request.protocol}* avançada de *${currentLabel}* para *${nextLabel}* com sucesso.`,
          affected: [{ kind: 'surgery_request', id: requestId }],
        });
      } catch (err: unknown) {
        return buildToolResult({
          status: 'error',
          message: extractTransitionErrorMessage(
            err,
            'Erro ao avançar a solicitação',
          ),
        });
      }
    },
  };

  const setHasOpme: AiTool = {
    name: 'set_has_opme',
    requiredPermission: Permission.SOLICITACOES,
    mutates: true,
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
    },
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
        return buildToolResult({ status: 'blocked', message: auth.error });
      }
      const request = auth.request;
      const hasOpme = args.hasOpme === true;

      if (!args.confirm) {
        return buildToolResult({
          status: 'pending_confirmation',
          message: `Deseja ${hasOpme ? 'marcar' : 'desmarcar'} a solicitação ${request.protocol} como ${hasOpme ? 'possuindo' : 'não possuindo'} OPME? Confirme com "sim".`,
          pendingConfirmation: {
            tool: 'set_has_opme',
            args: { ...args, confirm: true },
            description: 'definir se a solicitação possui OPME',
          },
        });
      }

      await mutationService.setHasOpme(request.id, hasOpme, context.userId);
      await recordAiActivity(
        activityRepo,
        context,
        request.id,
        `OPME definido como: ${hasOpme ? 'Sim' : 'Não'}.`,
      );

      return buildToolResult({
        status: 'ok',
        message: `Solicitação ${request.protocol} atualizada: OPME = ${hasOpme ? 'Sim' : 'Não'}.`,
        affected: [{ kind: 'surgery_request', id: request.id }],
      });
    },
  };

  const closeSurgeryRequest: AiTool = {
    name: 'close_surgery_request',
    requiredPermission: Permission.SOLICITACOES,
    mutates: true,
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
    },
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
          message: auth.error,
        });
      }
      const request = auth.request;
      const requestId = request.id;

      if (!args.confirm) {
        const preview = `Atenção: você está prestes a *encerrar* a solicitação ${request.protocol}.\nMotivo: "${argToString(args.reason)}"\n\nEssa ação não pode ser desfeita. Confirme com "sim".`;
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
          { reason: typeof args.reason === 'string' ? args.reason : undefined },
          context.userId,
        );
        await recordAiActivity(
          activityRepo,
          context,
          requestId,
          `Solicitação encerrada. Motivo: "${argToString(args.reason)}".`,
        );
        return buildToolResult({
          status: 'ok',
          message: `Solicitação ${request.protocol} encerrada com sucesso.`,
          affected: [{ kind: 'surgery_request', id: requestId }],
        });
      } catch (err: unknown) {
        return buildToolResult({
          status: 'error',
          message: extractTransitionErrorMessage(err, 'Erro ao encerrar'),
        });
      }
    },
  };

  return [advanceSurgeryRequest, setHasOpme, closeSurgeryRequest];
}
