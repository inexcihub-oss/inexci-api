import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { ActivityType } from '../../../../../database/entities/surgery-request-activity.entity';
import { FlowDraftDeps } from '../_types';

export function buildSchedulingDraftCommitTool(deps: FlowDraftDeps): AiTool {
  const { draftService, workflowService, activityRepo } = deps;
  return {
    name: 'scheduling_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'scheduling_draft_commit',
        description:
          'Aplica o agendamento após confirmação (`confirm=true`). Se `dateOptions` está preenchido, atualiza as opções. Se `confirmedDateIndex` está preenchido, confirma a data.',
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
            'Para aplicar o agendamento, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'scheduling',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de agendamento ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      try {
        const hasOptions =
          Array.isArray(f.dateOptions) && f.dateOptions.length > 0;
        if (hasOptions) {
          await workflowService.updateDateOptions(
            f.surgeryRequestId!,
            { dateOptions: f.dateOptions } as any,
            context.userId,
          );
        }
        if (f.confirmedDateIndex !== undefined) {
          await workflowService.confirmDate(
            f.surgeryRequestId!,
            { selectedDateIndex: f.confirmedDateIndex } as any,
            context.userId,
          );
        }
        await activityRepo.create({
          surgeryRequestId: f.surgeryRequestId!,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Agendamento via draft: ${hasOptions ? 'opções definidas' : ''}${
            f.confirmedDateIndex !== undefined
              ? `${hasOptions ? '; ' : ''}data confirmada (opção #${f.confirmedDateIndex + 1})`
              : ''
          }.`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          message: `Agendamento aplicado para a solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId}.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao agendar: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };
}
