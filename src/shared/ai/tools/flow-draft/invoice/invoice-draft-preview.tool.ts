import OpenAI from 'openai';
import { AiTool } from '../../tool.interface';
import { buildToolResult } from '../../tool-result';
import { FlowDraftDeps } from '../_types';

export function buildInvoiceDraftPreviewTool(deps: FlowDraftDeps): AiTool {
  const { draftService } = deps;
  return {
    name: 'invoice_draft_preview',
    definition: {
      type: 'function',
      function: {
        name: 'invoice_draft_preview',
        description: 'Gera o preview do rascunho de faturamento.',
        parameters: { type: 'object', properties: {} },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(_args, context) {
      const v = await draftService.validate(context.conversationId, 'invoice');
      if (!v.draft) {
        return buildToolResult({
          status: 'blocked',
          message: 'Não há rascunho de faturamento ativo.',
        });
      }
      if (!v.isReady) {
        return buildToolResult({
          status: 'needs_input',
          message: `Faltam: ${v.missing.join(', ')}.`,
          nextRequiredFields: v.missing,
        });
      }
      const { text } = await draftService.getPreview(
        context.conversationId,
        'invoice',
        true,
      );
      return buildToolResult({
        status: 'pending_confirmation',
        displayText: text,
      });
    },
  };
}
