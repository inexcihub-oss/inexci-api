import { AiTool } from '../../tool.interface';
import { Permission } from 'src/shared/permissions';
import { buildToolResult } from '../../tool-result';
import { FlowDraftDeps } from '../_types';
import { recordAiActivity } from '../../helpers/surgery-request-access';
import { errorMessage } from '../../../../utils/error-message.util';
import { SendMethod } from '../../../../constants/send-method';

export function buildContestationDraftCommitTool(deps: FlowDraftDeps): AiTool {
  const { draftService, workflowService, activityRepo } = deps;
  return {
    name: 'contestation_draft_commit',
    requiredPermission: Permission.SOLICITACOES,
    mutates: true,
    definition: {
      type: 'function',
      function: {
        name: 'contestation_draft_commit',
        description:
          'Registra a contestação após confirmação (`confirm=true`). Roteia para `contestAuthorization` ou `contestPayment` conforme o `contestationType`.',
        parameters: {
          type: 'object',
          properties: { confirm: { type: 'boolean' } },
          required: ['confirm'],
        },
      },
    },
    async execute(args, context) {
      if (!context.userId) {
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      }
      if (!args.confirm) {
        return buildToolResult({
          status: 'pending_confirmation',
          message:
            'Para registrar a contestação, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'contestation',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de contestação ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      try {
        if (f.contestationType === 'AUTHORIZATION') {
          await workflowService.contestAuthorization(
            f.surgeryRequestId!,
            {
              reason: f.reason!,
              method: (f.method ?? 'document') as SendMethod,
              to: f.to,
              subject: f.subject,
              message: f.message,
              attachments: f.attachments,
            },
            context.userId,
          );
        } else {
          await workflowService.contestPayment(
            f.surgeryRequestId!,
            {
              to: f.to!,
              subject: f.subject!,
              message: f.message!,
              attachments: f.attachments,
            },
            context.userId,
          );
        }
        await recordAiActivity(
          activityRepo,
          context,
          f.surgeryRequestId!,
          `Contestação (${f.contestationType}) registrada.`,
        );
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          affected: [{ kind: 'surgery_request', id: f.surgeryRequestId! }],
          message: `Contestação registrada com sucesso para a solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId}.`,
        });
      } catch (err) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao contestar: ${errorMessage(err) || 'erro desconhecido'}`,
        });
      }
    },
  };
}
