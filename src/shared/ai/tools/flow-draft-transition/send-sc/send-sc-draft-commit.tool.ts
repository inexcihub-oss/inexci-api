import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { ActivityType } from '../../../../../database/entities/surgery-request-activity.entity';
import { SurgeryRequestStatus } from '../../../../../database/entities/surgery-request.entity';
import { SendMethod } from '../../../../constants/send-method';
import { FlowDraftTransitionDeps } from '../_types';
import { assertCurrentStatusIs } from '../_helpers';

export function buildSendScDraftCommitTool(
  deps: FlowDraftTransitionDeps,
): AiTool {
  const { draftService, workflowService, activityRepo, surgeryRequestRepo } =
    deps;
  return {
    name: 'send_sc_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'send_sc_draft_commit',
        description:
          'Envia a SC para análise após confirmação (`confirm=true`). Avança status PENDING → SENT.',
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
            'Para enviar a solicitação, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(context.conversationId, 'send_sc');
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de envio ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      const statusError = await assertCurrentStatusIs(
        surgeryRequestRepo,
        f.surgeryRequestId!,
        SurgeryRequestStatus.PENDING,
      );
      if (statusError) return statusError;

      try {
        await workflowService.sendRequest(
          f.surgeryRequestId!,
          {
            method:
              f.method === 'email' ? SendMethod.EMAIL : SendMethod.DOWNLOAD,
            to: f.to,
            subject: f.subject,
            message: f.message,
            notifyPatient: f.notifyPatient,
          } as any,
          context.userId,
        );
        await activityRepo.create({
          surgeryRequestId: f.surgeryRequestId!,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Solicitação enviada para análise via draft (${f.method}).`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          message: `Solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId} enviada para análise com sucesso.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao enviar: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };
}
