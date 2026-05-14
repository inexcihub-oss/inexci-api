import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { ActivityType } from '../../../../../database/entities/surgery-request-activity.entity';
import { SurgeryRequestStatus } from '../../../../../database/entities/surgery-request.entity';
import { FlowDraftTransitionDeps } from '../_types';
import { assertCurrentStatusIs } from '../_helpers';

export function buildStartAnalysisDraftCommitTool(
  deps: FlowDraftTransitionDeps,
): AiTool {
  const { draftService, workflowService, activityRepo, surgeryRequestRepo } =
    deps;
  return {
    name: 'start_analysis_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'start_analysis_draft_commit',
        description:
          'Marca a SC como Em Análise após confirmação (`confirm=true`). Avança status SENT → IN_ANALYSIS.',
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
            'Para iniciar a análise, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(
        context.conversationId,
        'start_analysis',
      );
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de análise ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const f = v.draft.fields;
      const statusError = await assertCurrentStatusIs(
        surgeryRequestRepo,
        f.surgeryRequestId!,
        SurgeryRequestStatus.SENT,
      );
      if (statusError) return statusError;

      try {
        await workflowService.startAnalysis(
          f.surgeryRequestId!,
          {
            requestNumber: f.requestNumber!,
            receivedAt: f.receivedAt!,
            quotation1Number: f.quotation1Number ?? undefined,
            quotation1ReceivedAt: f.quotation1ReceivedAt ?? undefined,
            quotation2Number: f.quotation2Number ?? undefined,
            quotation2ReceivedAt: f.quotation2ReceivedAt ?? undefined,
            quotation3Number: f.quotation3Number ?? undefined,
            quotation3ReceivedAt: f.quotation3ReceivedAt ?? undefined,
            notes: f.notes ?? undefined,
            notifyPatient: f.notifyPatient,
          } as any,
          context.userId,
        );
        await activityRepo.create({
          surgeryRequestId: f.surgeryRequestId!,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Análise iniciada via draft. Nº operadora: ${f.requestNumber}.`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: f.surgeryRequestId,
          label: f.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          message: `Análise da solicitação ${f.surgeryRequestLabel ?? f.surgeryRequestId} iniciada com sucesso.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao iniciar análise: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };
}
