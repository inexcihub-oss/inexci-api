import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { ActivityType } from '../../../../../database/entities/surgery-request-activity.entity';
import { FlowDraftDeps } from '../_types';

export function buildInvoiceDraftCommitTool(deps: FlowDraftDeps): AiTool {
  const { draftService, workflowService, activityRepo } = deps;
  return {
    name: 'invoice_draft_commit',
    definition: {
      type: 'function',
      function: {
        name: 'invoice_draft_commit',
        description:
          'Registra o faturamento da SC após confirmação (`confirm=true`).',
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
            'Para registrar o faturamento, chame esta tool com `confirm=true`.',
        });
      }
      const v = await draftService.validate(context.conversationId, 'invoice');
      if (!v.draft || !v.isReady) {
        return buildToolResult({
          status: 'blocked',
          message: v.draft
            ? `Faltam: ${v.missing.join(', ')}.`
            : 'Não há rascunho de faturamento ativo.',
          nextRequiredFields: v.missing,
        });
      }
      const fields = v.draft.fields;
      try {
        await workflowService.invoiceRequest(
          fields.surgeryRequestId!,
          {
            invoiceProtocol: fields.invoiceProtocol!,
            invoiceValue: fields.invoiceValue!,
            invoiceSentAt: fields.invoiceSentAt!,
            paymentDeadline: fields.paymentDeadline ?? undefined,
            setAsDefaultForHealthPlan:
              fields.setAsDefaultForHealthPlan === true,
          },
          context.userId,
        );
        await activityRepo.create({
          surgeryRequestId: fields.surgeryRequestId!,
          userId: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Faturamento registrado via draft. Protocolo: ${fields.invoiceProtocol}, valor: ${fields.invoiceValue?.toFixed(2)}.`,
        });
        await draftService.finalizeCommit(context.conversationId, {
          id: fields.surgeryRequestId,
          label: fields.surgeryRequestLabel,
        });
        return buildToolResult({
          status: 'ok',
          data: { surgeryRequestId: fields.surgeryRequestId },
          message: `Faturamento registrado com sucesso para a solicitação ${fields.surgeryRequestLabel ?? fields.surgeryRequestId}.`,
        });
      } catch (err: any) {
        return buildToolResult({
          status: 'error',
          message: `Erro ao faturar: ${err?.message || 'erro desconhecido'}`,
        });
      }
    },
  };
}
