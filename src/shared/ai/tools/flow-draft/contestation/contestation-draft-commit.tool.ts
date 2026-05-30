import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { ActivityType } from '../../../../../database/entities/surgery-request-activity.entity';
import { FlowDraftDeps } from '../_types';

export function buildContestationDraftCommitTool(deps: FlowDraftDeps): AiTool {
  const { draftService, workflowService, activityRepo } = deps;
  return {
    name: 'contestation_draft_commit',
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
    } as OpenAI.ChatCompletionTool,
    async execute(args, context) {
      if (!context.userId) {
        return buildToolResult({ status: 'error', message: 'Acesso negado.' });
      }
      if (!(args as any).confirm) {
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
              method: (f.method ?? 'document') as any,
              to: f.to,
              subject: f.subject,
              message: f.message,
              attachments: f.attachments,
            } as any,
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
            } as any,
            context.userId,
          );
        }
        await activityRepo.create({
          surgeryRequestId: f.surgeryRequestId!,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Contestação (${f.contestationType}) registrada.`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          message: `Contestação registrada com sucesso para a solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId}.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao contestar: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };
}
