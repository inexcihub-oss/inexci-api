import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { FlowDraftTransitionDeps } from '../_types';

export function buildSendScDraftPreviewTool(
  deps: FlowDraftTransitionDeps,
): AiTool {
  const { draftService, pendencyValidator } = deps;
  return {
    name: 'send_sc_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'send_sc_draft_preview',
        description:
          'Gera o preview do envio (status checklist + método). Valida pendências bloqueantes (TUSS, OPME, laudo, hospital) antes de aceitar.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(context.conversationId, 'send_sc');
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de envio ativo.',
        });
      }

      const fields = v.draft.fields;
      const requiresEmailFields = fields.method === 'email';
      const missing = [...v.missing];
      if (requiresEmailFields) {
        if (!fields.to || !fields.to.trim()) missing.push('to');
        if (!fields.subject || !fields.subject.trim()) missing.push('subject');
      }
      if (missing.length) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam: ${missing.join(', ')}.`,
          nextRequiredFields: missing,
        });
      }

      if (fields.surgeryRequestId) {
        const summary = await pendencyValidator.getSummary(
          fields.surgeryRequestId,
        );
        if (!summary.canAdvance) {
          const blockingPendencies = summary.items
            .filter((p) => p.blocking && !p.resolved)
            .map((p) => `• ${p.label}`)
            .join('\n');
          return buildToolResult({
            status: 'blocked',
            message: `A solicitação ainda tem pendências bloqueantes que precisam ser resolvidas antes do envio:\n${blockingPendencies}`,
          });
        }
      }

      const { text } = await draftService.getPreview(
        context.conversationId,
        'send_sc',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };
}
