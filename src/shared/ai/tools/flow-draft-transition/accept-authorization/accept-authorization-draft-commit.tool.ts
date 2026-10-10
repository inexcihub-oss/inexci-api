import { AiTool } from '../../tool.interface';
import { Permission } from 'src/shared/permissions';
import { buildToolResult } from '../../tool-result';
import { SurgeryRequestStatus } from '../../../../../database/entities/surgery-request.entity';
import { FlowDraftTransitionDeps } from '../_types';
import {
  assertCurrentStatusIs,
  extractTransitionErrorMessage,
} from '../_helpers';
import { recordAiActivity } from '../../helpers/surgery-request-access';

export function buildAcceptAuthorizationDraftCommitTool(
  deps: FlowDraftTransitionDeps,
): AiTool {
  const { draftService, workflowService, activityRepo, surgeryRequestRepo } =
    deps;
  return {
    name: 'accept_authorization_draft_commit',
    requiredPermission: Permission.SOLICITACOES,
    mutates: true,
    definition: {
      type: 'function',
      function: {
        name: 'accept_authorization_draft_commit',
        description:
          'Aceita a autorização e registra as opções de data após confirmação (`confirm=true`). Avança status IN_ANALYSIS → IN_SCHEDULING.',
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
            'Para aceitar a autorização, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'accept_authorization',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de aceite ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      const status = await assertCurrentStatusIs(
        surgeryRequestRepo,
        f.surgeryRequestId!,
        SurgeryRequestStatus.IN_ANALYSIS,
        context,
      );
      if (status.error) return status.error;
      const surgeryRequestId = status.resolvedId!;

      try {
        await workflowService.acceptAuthorization(
          surgeryRequestId,
          {
            dateOptions: f.dateOptions!,
            notifyPatient: f.notifyPatient,
          },
          context.userId,
        );
        await recordAiActivity(
          activityRepo,
          context,
          surgeryRequestId,
          `Autorização aceita. ${f.dateOptions!.length} data(s) proposta(s).`,
        );
        await draftService.finalizeCommit(context.conversationId, {
          id: surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          affected: [{ kind: 'surgery_request', id: surgeryRequestId }],
          message: `Autorização aceita para a solicitação ${f.surgeryRequestLabel ?? surgeryRequestId}.`,
        });
      } catch (err) {
        return buildToolResult({
          status: 'error',
          message: extractTransitionErrorMessage(
            err,
            'Erro ao aceitar autorização',
          ),
        });
      }
    },
  };
}
