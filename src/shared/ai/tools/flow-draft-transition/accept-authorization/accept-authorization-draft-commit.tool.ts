import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { ActivityType } from '../../../../../database/entities/surgery-request-activity.entity';
import { SurgeryRequestStatus } from '../../../../../database/entities/surgery-request.entity';
import { FlowDraftTransitionDeps } from '../_types';
import { assertCurrentStatusIs } from '../_helpers';

export function buildAcceptAuthorizationDraftCommitTool(
  deps: FlowDraftTransitionDeps,
): AiTool {
  const { draftService, workflowService, activityRepo, surgeryRequestRepo } =
    deps;
  return {
    name: 'accept_authorization_draft_commit',
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
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      if (!context.userId) {
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      }
      if (!(args as any).confirm) {
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
      );
      if (status.error) return status.error;
      const surgeryRequestId = status.resolvedId!;

      try {
        await workflowService.acceptAuthorization(
          surgeryRequestId,
          {
            dateOptions: f.dateOptions!,
            notifyPatient: f.notifyPatient,
          } as any,
          context.userId,
        );
        await activityRepo.create({
          surgeryRequestId,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Autorização aceita. ${f.dateOptions!.length} data(s) proposta(s).`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          message: `Autorização aceita para a solicitação ${f.surgeryRequestLabel ?? surgeryRequestId}.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao aceitar autorização: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };
}
